import { useMemo } from "react";
import type React from "react";
import type { PolyProps } from "./types";
import {
  computeTextureAtlasPlan,
  TextureBorderShapePoly,
  TextureAtlasPoly,
  useTextureAtlas,
} from "../scene/textureAtlas";

/**
 * Poly — renders one polygon as an atlas-backed DOM sprite.
 *
 * Public API: `{ vertices, color?, texture?, uvs?, data? }` plus DOM
 * passthrough props. The atlas renderer handles both textured and solid-color
 * faces, so `<Poly>` never emits SVG in the normal render path.
 */
export function Poly({
  vertices,
  color,
  texture,
  uvs,
  data,
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

  const atlasPlan = useMemo(
    () => computeTextureAtlasPlan(
      { vertices, color: polygonColor, texture, uvs, data },
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
      texture,
      uvs,
      data,
      tileSize,
      layerElevation,
      context?.directionalLight,
    ],
  );
  const atlasPlans = useMemo(() => [atlasPlan], [atlasPlan]);
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

  const atlasEntry = textureAtlas.entries[0];
  let front: React.ReactNode = null;

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
    front = (
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
