/**
 * GlyphHotspot — an interactive overlay element positioned at a 3D world point.
 *
 * Wraps `scene.addHotspot()`. The scene projects the `at` position into grid
 * cell coordinates on each render, and the glyphcss backend positions the
 * overlay div accordingly over the <pre> output.
 *
 * Children are portalled into the absolutely-positioned overlay div so they
 * track the hotspot as the camera moves.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  // Track the overlay DOM element so we can portal children into it.
  const [overlayEl, setOverlayEl] = useState<HTMLElement | null>(null);

  // Register with the scene's hotspot system
  const atKey = useMemo(() => at.join(","), [at]);
  const sizeKey = size ? size.join(",") : "";

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.addHotspot(
      { id, at, size },
      () => onClickRef.current?.({} as Parameters<NonNullable<typeof onClick>>[0]),
    );
    hotspotRef.current = handle;
    setOverlayEl(handle.el);
    return () => {
      handle.remove();
      hotspotRef.current = null;
      setOverlayEl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, id, atKey, sizeKey]);

  // Wire the onClick handler to the overlay element.
  useEffect(() => {
    const el = overlayEl;
    if (!el || !onClick) return;
    const handler = (e: MouseEvent) => onClick(e as unknown as Parameters<NonNullable<typeof onClick>>[0]);
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [overlayEl, onClick]);

  // Apply className to the overlay div.
  useEffect(() => {
    if (!overlayEl) return;
    overlayEl.className = `glyph-hotspot${className ? ` ${className}` : ""}`;
  }, [overlayEl, className]);

  // Portal children into the absolutely-positioned overlay div so they move
  // with the hotspot on every render cycle.
  if (!children || !overlayEl) return null;
  return createPortal(children, overlayEl);
}

export const GlyphHotspot = memo(GlyphHotspotInner);
