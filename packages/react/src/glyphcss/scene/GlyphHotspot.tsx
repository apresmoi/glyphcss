/**
 * GlyphHotspot — an interactive overlay element positioned at a 3D world point.
 *
 * Wraps `scene.addHotspot()`. The scene projects the `at` position into grid
 * cell coordinates on each render, and the glyphcss backend positions the
 * overlay div accordingly over the <pre> output.
 *
 * Children render inside the absolutely-positioned overlay div.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { ReactNode, MouseEventHandler } from "react";
import type { Vec3 } from "@glyphcss/core";
import type { GlyphHotspotHandle } from "glyphcss";
import { useGlyphSceneContext } from "./context";

export interface GlyphHotspotProps {
  /** Stable identifier for this hotspot. */
  id: string;
  /** 3D world-space anchor. */
  at: Vec3;
  /** Hitbox size in character cells `[cols, rows]`. Default `[1, 1]`. */
  size?: [number, number];
  onClick?: MouseEventHandler<HTMLDivElement>;
  className?: string;
  "aria-label"?: string;
  children?: ReactNode;
}

function GlyphHotspotInner({
  id,
  at,
  size,
  onClick,
  className,
  children,
}: GlyphHotspotProps) {
  const { sceneRef } = useGlyphSceneContext();
  const hotspotRef = useRef<GlyphHotspotHandle | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  // Register with the scene's hotspot system
  const atKey = useMemo(() => at.join(","), [at]);
  const sizeKey = size ? size.join(",") : "";

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.addHotspot(
      { id, at, size },
      () => {
        // Dispatch a synthetic click — the hotspot overlay handles native clicks,
        // but the onClick prop wires React event handlers.
      },
    );
    hotspotRef.current = handle;
    return () => {
      handle.remove();
      hotspotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, id, atKey, sizeKey]);

  // The actual visible element is rendered by the scene's hotspot-layer,
  // not by this React component. We render children as a portal-like slot
  // only when there are custom children to show (tooltips etc).
  // For the basic case (no children), this component is purely imperative.
  if (!children && !onClick && !className) return null;

  // When children are provided, render them alongside — the scene-injected
  // hotspot div handles the positioning, and children can be placed in the
  // glyph-hotspot div via the scene's DOM directly. Since the scene
  // inserts the div into hotspot-layer (not into this React tree), we
  // expose a data-hotspot-id attribute on a zero-size sentinel so callers
  // can query and inject via refs if needed.
  return (
    <div
      data-glyph-hotspot-id={id}
      className={className}
      style={{ display: "contents" }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export const GlyphHotspot = memo(GlyphHotspotInner);
