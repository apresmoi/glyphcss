/**
 * GlyphcssScene — React wrapper for the ASCII paint backend.
 *
 * Mounts a `createGlyphcssScene` handle in a host div, injects base styles,
 * and provides the scene handle via GlyphcssSceneContext so child components
 * (GlyphcssMesh, GlyphcssHotspot, controls) can register with it.
 *
 * No atlas, no matrix3d, no CSS polygon leaves — the ASCII rasterizer
 * writes into a single <pre> element per render.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { RenderMode } from "@layoutit/polycss-core";
import type {
  GlyphcssSceneOptions,
  GlyphcssDirectionalLight,
  GlyphcssAmbientLight,
} from "glyphcss";
import { createGlyphcssScene, injectGlyphcssBaseStyles } from "glyphcss";
import { GlyphcssSceneContext } from "./context";

export interface GlyphcssSceneProps {
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
  directionalLight?: GlyphcssDirectionalLight;
  ambientLight?: GlyphcssAmbientLight;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function GlyphcssSceneInner({
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
}: GlyphcssSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ReturnType<typeof createGlyphcssScene> | null>(null);

  // Build the initial scene options once
  const initialOpts: GlyphcssSceneOptions = useMemo(() => ({
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
      injectGlyphcssBaseStyles(el.ownerDocument ?? undefined);
      sceneRef.current = createGlyphcssScene(el, initialOpts);
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
    const partial: Partial<GlyphcssSceneOptions> = {};
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

  const computedClassName = `glyphcss-host${className ? ` ${className}` : ""}`;

  return (
    <GlyphcssSceneContext.Provider value={ctxValue}>
      <div ref={hostCallbackRef} className={computedClassName} style={style}>
        {children}
      </div>
    </GlyphcssSceneContext.Provider>
  );
}

export const GlyphcssScene = memo(GlyphcssSceneInner);
