import type {
  Vec2,
  Vec3,
  DirectionalLight,
  TextureLightingMode,
} from "@polycss/core";
import type {
  CSSProperties,
  MouseEventHandler,
  PointerEventHandler,
  FocusEventHandler,
  KeyboardEventHandler,
} from "react";

// ── TransformProps ──────────────────────────────────────────────────────────

/**
 * Three.js-style transform props accepted by every polycss component.
 * In Phase 3, position/scale/rotation are accepted but not yet applied —
 * the rendered transform comes from vertices in scene-root space.
 * Phase 4 wires these into the matrix3d composition with parent PolyMesh.
 */
export interface TransformProps {
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3; // euler degrees [x, y, z]
}

// ── DOMPassthroughProps ────────────────────────────────────────────────────

/**
 * DOM event handlers, ARIA, and style props forwarded to the rendered
 * element (<img> or <svg>) by every Poly component.
 *
 * This is the DOM-native pitch: polygons are real DOM nodes you can
 * target with CSS, attach event handlers to, and inspect in DevTools.
 */
export interface DOMPassthroughProps {
  className?: string;
  style?: CSSProperties;
  id?: string;
  // Mouse / pointer
  onClick?: MouseEventHandler<HTMLElement>;
  onDoubleClick?: MouseEventHandler<HTMLElement>;
  onMouseEnter?: MouseEventHandler<HTMLElement>;
  onMouseLeave?: MouseEventHandler<HTMLElement>;
  onMouseMove?: MouseEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onPointerUp?: PointerEventHandler<HTMLElement>;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  // Focus
  onFocus?: FocusEventHandler<HTMLElement>;
  onBlur?: FocusEventHandler<HTMLElement>;
  // Keyboard
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  // ARIA
  tabIndex?: number;
  role?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean;
  // Pointer-events escape hatch — default "auto" (DOM-native receives events).
  // Set to "none" for purely decorative polygons that should be click-through.
  pointerEvents?: "auto" | "none";
  // data-* attributes forwarded directly. Polygon.data is also reflected as
  // data-* attributes automatically; use this for attrs not in Polygon.data.
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

// ── PolyProps ──────────────────────────────────────────────────────────────

/**
 * Props for the `<Poly>` component — the atomic polygon primitive.
 *
 * Extends TransformProps + DOMPassthroughProps with the polygon's own fields.
 * This is the canonical polycss v0.1.0 Poly component API per §API freeze.
 */
export interface PolyProps extends TransformProps, DOMPassthroughProps {
  // Polygon fields (from Polygon type)
  vertices: Vec3[];
  color?: string;
  texture?: string;
  uvs?: Vec2[];
  data?: Record<string, string | number | boolean>;

  // Internal props forwarded from parent scene/context.
  // These are set by PolyScene, not by end users.
  context?: {
    tileSize?: number;
    layerElevation?: number;
    directionalLight?: DirectionalLight;
    textureLighting?: TextureLightingMode;
    debugShowBackfaces?: boolean;
    [key: string]: unknown;
  };
  /** Textured polygon lighting mode. Defaults to scene context, then "baked". */
  textureLighting?: TextureLightingMode;
  /** Pre-computed shaded base color from the parent (optional override). */
  baseColor?: string;
}
