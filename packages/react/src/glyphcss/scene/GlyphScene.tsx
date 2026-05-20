/**
 * GlyphScene — React wrapper for the ASCII paint backend.
 *
 * Mounts a `createGlyphScene` handle in a host div, injects base styles,
 * and provides the scene handle via GlyphSceneContext so child components
 * (GlyphMesh, GlyphHotspot, controls) can register with it.
 *
 * No atlas, no matrix3d, no CSS polygon leaves — the ASCII rasterizer
 * writes into a single <pre> element per render.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { RenderMode } from "@glyphcss/core";
import type {
  GlyphSceneOptions,
  GlyphDirectionalLight,
  GlyphAmbientLight,
} from "glyphcss";
import { createGlyphScene, injectGlyphBaseStyles } from "glyphcss";
import { GlyphSceneContext } from "./context";

export interface GlyphSceneProps {
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
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function GlyphSceneInner({
  mode,
  glyphPalette,
  useColors,
  cols,
  rows,
  cellAspect,
  directionalLight,
  ambientLight,
  className,
  style,
  children,
}: GlyphSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ReturnType<typeof createGlyphScene> | null>(null);

  // Build the initial scene options once
  const initialOpts: GlyphSceneOptions = useMemo(() => ({
    mode,
    glyphPalette,
    useColors,
    cols,
    rows,
    cellAspect,
    directionalLight,
    ambientLight,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mount / destroy the scene when the host element mounts / unmounts
  const hostCallbackRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !sceneRef.current) {
      hostRef.current = el;
      injectGlyphBaseStyles(el.ownerDocument ?? undefined);
      sceneRef.current = createGlyphScene(el, initialOpts);
    } else if (!el && sceneRef.current) {
      sceneRef.current.destroy();
      sceneRef.current = null;
      hostRef.current = null;
    }
  }, [initialOpts]);

  // Sync option props to the live scene handle
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const partial: Partial<GlyphSceneOptions> = {};
    if (mode !== undefined) partial.mode = mode;
    if (glyphPalette !== undefined) partial.glyphPalette = glyphPalette;
    if (useColors !== undefined) partial.useColors = useColors;
    if (cols !== undefined) partial.cols = cols;
    if (rows !== undefined) partial.rows = rows;
    if (cellAspect !== undefined) partial.cellAspect = cellAspect;
    if (directionalLight !== undefined) partial.directionalLight = directionalLight;
    if (ambientLight !== undefined) partial.ambientLight = ambientLight;
    if (Object.keys(partial).length > 0) {
      scene.setOptions(partial);
    }
  }, [mode, glyphPalette, useColors, cols, rows, cellAspect, directionalLight, ambientLight]);

  const ctxValue = useMemo(() => ({ sceneRef }), [sceneRef]);

  const computedClassName = `glyph-host${className ? ` ${className}` : ""}`;

  return (
    <GlyphSceneContext.Provider value={ctxValue}>
      <div ref={hostCallbackRef} className={computedClassName} style={style}>
        {children}
      </div>
    </GlyphSceneContext.Provider>
  );
}

export const GlyphScene = memo(GlyphSceneInner);
