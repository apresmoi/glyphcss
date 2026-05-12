import { memo, useMemo } from "react";
import type React from "react";
import type { CSSProperties } from "react";
import type { Vec2, PolyMaterial } from "@layoutit/polycss-core";
import type { PolyProps } from "./types";
import {
  computeTextureAtlasPlan,
  isSolidTrianglePlan,
  TextureBorderShapePoly,
  TextureAtlasPoly,
  TextureTrianglePoly,
  useTextureAtlas,
  type TextureAtlasPlan,
} from "../scene/textureAtlas";

// ── Material / direct render path ────────────────────────────────────────────

/**
 * Detect whether a 4-vertex UV array forms an axis-aligned rectangle.
 * Returns {u0, u1, v0, v1} (with u0 < u1, v0 < v1) when yes, null otherwise.
 */
function isAxisAlignedRectUVs(uvs: Vec2[]): { u0: number; u1: number; v0: number; v1: number } | null {
  if (uvs.length !== 4) return null;
  const us = [...new Set(uvs.map((uv) => uv[0]))].sort((a, b) => a - b);
  const vs = [...new Set(uvs.map((uv) => uv[1]))].sort((a, b) => a - b);
  if (us.length !== 2 || vs.length !== 2) return null;
  const corners = new Set([
    `${us[0]},${vs[0]}`,
    `${us[0]},${vs[1]}`,
    `${us[1]},${vs[0]}`,
    `${us[1]},${vs[1]}`,
  ]);
  for (const uv of uvs) {
    if (!corners.has(`${uv[0]},${uv[1]}`)) return null;
  }
  return { u0: us[0], u1: us[1], v0: vs[0], v1: vs[1] };
}

/**
 * Direct material render — emits an <i> with background-image pointing
 * directly at the shared material texture, no canvas rasterization.
 *
 * Background-position/size math:
 *   OBJ convention: v=0 at bottom, v=1 at top. The source image Y-axis
 *   points DOWN (top=0, bottom=1), so in source-pixel space the visual
 *   top of the UV slice is at y = (1 - vMax) * sourceH.
 *
 *   Scale: we want the UV rect [du × dv] to fill [canvasW × canvasH].
 *     sourceW = canvasW / du
 *     sourceH = canvasH / dv
 *
 *   Offset: background-position specifies where the source top-left lands
 *   relative to the <i> top-left. We need the UV slice's top-left
 *   (u0, 1-vMax in source Y) to land at the <i> origin (0,0):
 *     offsetX = u0 * sourceW
 *     offsetY = (1 - vMax) * sourceH
 */
function MaterialDirectPoly({
  plan,
  material,
  uvRect,
  className,
  style: styleProp,
  domAttrs,
  domEventHandlers,
  pointerEvents = "auto",
}: {
  plan: TextureAtlasPlan;
  material: PolyMaterial;
  uvRect: { u0: number; u1: number; v0: number; v1: number };
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  domEventHandlers?: React.DOMAttributes<Element>;
  pointerEvents?: "auto" | "none";
}) {
  const { u0, u1, v0, v1 } = uvRect;
  const du = u1 - u0;
  const dv = v1 - v0;
  const sourceW = plan.canvasW / du;
  const sourceH = plan.canvasH / dv;
  const vMax = Math.max(v0, v1);
  const offsetX = u0 * sourceW;
  const offsetY = (1 - vMax) * sourceH;

  const style: CSSProperties = {
    width: plan.canvasW,
    height: plan.canvasH,
    transform: `matrix3d(${plan.matrix})`,
    backgroundImage: `url(${material.texture})`,
    backgroundSize: `${sourceW}px ${sourceH}px`,
    backgroundPosition: `-${offsetX}px -${offsetY}px`,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = plan.polygon.data
    ? Object.fromEntries(
        Object.entries(plan.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return (
    <i
      className={elementClassName}
      style={style}
      {...domEventHandlers}
      {...dataAttrs}
      {...domAttrs}
    />
  );
}

/**
 * Poly — renders one polygon as an atlas-backed DOM sprite.
 *
 * Public API: `{ vertices, color?, texture?, uvs?, data? }` plus DOM
 * passthrough props. The atlas renderer handles both textured and solid-color
 * faces, so `<Poly>` never emits SVG in the normal render path.
 *
 * Wrapped in React.memo so parent re-renders (e.g. camera rotation updating
 * rotY state) do not re-render stable polygon children. The shallow-equality
 * check is sound here because polygon data (vertices, color, texture) is
 * typically created once at parse time and passed by reference.
 */
function PolyInner({
  vertices,
  color,
  texture,
  uvs,
  data,
  material,
  position,
  scale,
  rotation,
  className,
  style: styleProp,
  id,
  onClick,
  onDoubleClick,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onKeyDown,
  tabIndex,
  role,
  "aria-label": ariaLabel,
  "aria-hidden": ariaHidden,
  pointerEvents: pointerEventsProp,
  context,
  textureLighting: textureLightingProp,
  atlasScale: atlasScaleProp,
  baseColor: baseColorProp,
  ...dataAttrs
}: PolyProps) {
  const tileSize = context?.tileSize ?? 50;
  const layerElevation = context?.layerElevation ?? tileSize;
  const textureLighting = textureLightingProp ?? context?.textureLighting ?? "baked";
  const atlasScale = atlasScaleProp ?? context?.atlasScale;
  const polygonColor = baseColorProp ?? color;

  // material.texture takes precedence over inline texture.
  const effectiveTexture = material?.texture ?? texture;

  const atlasPlan = useMemo(
    () => computeTextureAtlasPlan(
      { vertices, color: polygonColor, texture: effectiveTexture, uvs, data },
      0,
      {
        tileSize,
        layerElevation,
        directionalLight: context?.directionalLight,
      },
    ),
    [
      vertices,
      polygonColor,
      effectiveTexture,
      uvs,
      data,
      tileSize,
      layerElevation,
      context?.directionalLight,
    ],
  );

  // Detect material direct-render path: material + 4-vertex axis-aligned rect UVs.
  const materialUvRect = useMemo(
    () => (material && uvs ? isAxisAlignedRectUVs(uvs) : null),
    [material, uvs],
  );

  const atlasPlans = useMemo(
    () => (materialUvRect ? [] : [atlasPlan]),
    [materialUvRect, atlasPlan],
  );
  const textureAtlas = useTextureAtlas(atlasPlans, textureLighting, atlasScale);

  const domEventHandlers: React.DOMAttributes<Element> = {
    onClick: onClick as React.MouseEventHandler<Element> | undefined,
    onDoubleClick: onDoubleClick as React.MouseEventHandler<Element> | undefined,
    onMouseEnter: onMouseEnter as React.MouseEventHandler<Element> | undefined,
    onMouseLeave: onMouseLeave as React.MouseEventHandler<Element> | undefined,
    onMouseMove: onMouseMove as React.MouseEventHandler<Element> | undefined,
    onPointerDown: onPointerDown as React.PointerEventHandler<Element> | undefined,
    onPointerUp: onPointerUp as React.PointerEventHandler<Element> | undefined,
    onPointerEnter: onPointerEnter as React.PointerEventHandler<Element> | undefined,
    onPointerLeave: onPointerLeave as React.PointerEventHandler<Element> | undefined,
    onFocus: onFocus as React.FocusEventHandler<Element> | undefined,
    onBlur: onBlur as React.FocusEventHandler<Element> | undefined,
    onKeyDown: onKeyDown as React.KeyboardEventHandler<Element> | undefined,
  };

  const domAttrs = {
    id,
    tabIndex,
    role,
    "aria-label": ariaLabel,
    "aria-hidden": ariaHidden,
    ...Object.fromEntries(
      Object.entries(dataAttrs).filter(([k]) => k.startsWith("data-")),
    ),
    ...(data
      ? Object.fromEntries(
          Object.entries(data).map(([k, v]) => [`data-${k}`, String(v)]),
        )
      : {}),
  };

  const transformParts: string[] = [];
  if (position) {
    transformParts.push(
      `translate3d(${position[0]}px, ${position[1]}px, ${position[2]}px)`,
    );
  }
  if (scale !== undefined) {
    if (typeof scale === "number") {
      if (scale !== 1) transformParts.push(`scale3d(${scale}, ${scale}, ${scale})`);
    } else {
      transformParts.push(`scale3d(${scale[0]}, ${scale[1]}, ${scale[2]})`);
    }
  }
  if (rotation) {
    if (rotation[0]) transformParts.push(`rotateX(${rotation[0]}deg)`);
    if (rotation[1]) transformParts.push(`rotateY(${rotation[1]}deg)`);
    if (rotation[2]) transformParts.push(`rotateZ(${rotation[2]}deg)`);
  }
  const wrapperTransform = transformParts.length > 0 ? transformParts.join(" ") : undefined;

  let front: React.ReactNode = null;

  if (materialUvRect && material && atlasPlan) {
    // Direct path: shared material texture, no atlas rasterization.
    front = (
      <MaterialDirectPoly
        plan={atlasPlan}
        material={material}
        uvRect={materialUvRect}
        className={className}
        style={styleProp}
        domAttrs={domAttrs}
        domEventHandlers={domEventHandlers}
        pointerEvents={pointerEventsProp ?? "auto"}
      />
    );
  } else {
    const atlasEntry = textureAtlas.entries[0];
    if (atlasEntry) {
      front = (
        <TextureAtlasPoly
          entry={atlasEntry}
          page={textureAtlas.pages[atlasEntry.pageIndex]}
          textureLighting={textureLighting}
          className={className}
          style={styleProp}
          domAttrs={domAttrs}
          domEventHandlers={domEventHandlers}
          pointerEvents={pointerEventsProp ?? "auto"}
        />
      );
    } else if (atlasPlan && !atlasPlan.texture) {
      front = isSolidTrianglePlan(atlasPlan) ? (
        <TextureTrianglePoly
          entry={atlasPlan}
          textureLighting={textureLighting}
          className={className}
          style={styleProp}
          domAttrs={domAttrs}
          domEventHandlers={domEventHandlers}
          pointerEvents={pointerEventsProp ?? "auto"}
        />
      ) : (
        <TextureBorderShapePoly
          entry={atlasPlan}
          className={className}
          style={styleProp}
          domAttrs={domAttrs}
          domEventHandlers={domEventHandlers}
          pointerEvents={pointerEventsProp ?? "auto"}
        />
      );
    }
  }

  if (!front) return null;

  if (!wrapperTransform) return front;

  return (
    <div
      className="polycss-poly-wrapper"
      style={{
        position: "absolute",
        transformStyle: "preserve-3d",
        transform: wrapperTransform,
      }}
    >
      {front}
    </div>
  );
}

export const Poly = memo(PolyInner);
