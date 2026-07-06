import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  loadMesh,
  recenterPolygons,
  resolveGeometry,
} from "@glyphcss/core";
import type {
  GlyphGeometryName,
  Polygon,
} from "@glyphcss/core";
import {
  Object3D,
  transformPolygonsToGlyph,
} from "@glyphcss/core/three";
import type { Vector3Tuple } from "@glyphcss/core/three";
import type { GlyphMeshHandle, GlyphMeshTransform } from "glyphcss";
import { useGlyphSceneContext } from "../glyphcss/scene/context";

export interface GlyphThreeMeshProps {
  id?: string;
  object?: Object3D;
  polygons?: Polygon[];
  src?: string;
  geometry?: GlyphGeometryName;
  size?: number;
  color?: string;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: number | Vector3Tuple;
  autoCenter?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  density?: number;
  fontSize?: string | number;
  lineHeight?: number;
  transparent?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function applyObjectProps(
  object: Object3D,
  {
    position,
    rotation,
    scale,
  }: Pick<GlyphThreeMeshProps, "position" | "rotation" | "scale">,
): Object3D {
  if (position) object.position.set(position[0], position[1], position[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (typeof scale === "number") object.scale.set(scale, scale, scale);
  else if (scale) object.scale.set(scale[0], scale[1], scale[2]);
  return object;
}

function GlyphThreeMeshInner({
  id,
  object: objectProp,
  polygons: polygonsProp,
  src,
  geometry,
  size = 1,
  color,
  position,
  rotation,
  scale,
  autoCenter = false,
  castShadow = false,
  receiveShadow = false,
  density,
  fontSize,
  lineHeight,
  transparent,
  className,
  style,
  children,
}: GlyphThreeMeshProps) {
  const { sceneRef } = useGlyphSceneContext();
  const meshRef = useRef<GlyphMeshHandle | null>(null);
  const objectRef = useRef<Object3D>(objectProp ?? new Object3D());
  const [loadedPolygons, setLoadedPolygons] = useState<Polygon[] | null>(null);

  useEffect(() => {
    if (!src) {
      setLoadedPolygons(null);
      return;
    }
    let cancelled = false;
    loadMesh(src)
      .then((result) => { if (!cancelled) setLoadedPolygons(result.polygons); })
      .catch(() => { if (!cancelled) setLoadedPolygons([]); });
    return () => { cancelled = true; };
  }, [src]);

  const sourcePolygons = useMemo(() => {
    const base =
      polygonsProp !== undefined
        ? polygonsProp
        : src !== undefined
          ? (loadedPolygons ?? [])
          : geometry !== undefined
            ? resolveGeometry(geometry, { size, color })
            : [];
    return autoCenter ? recenterPolygons(base) : base;
  }, [polygonsProp, src, loadedPolygons, geometry, size, color, autoCenter]);

  const glyphPolygons = useMemo(() => {
    const object = objectProp ?? objectRef.current;
    return transformPolygonsToGlyph(
      sourcePolygons,
      applyObjectProps(object, { position, rotation, scale }),
    );
  }, [sourcePolygons, objectProp, position, rotation, scale]);

  const transform = useMemo<GlyphMeshTransform>(() => ({
    id,
    castShadow,
    receiveShadow,
    density,
    fontSize,
    lineHeight,
    transparent,
  }), [id, castShadow, receiveShadow, density, fontSize, lineHeight, transparent]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.add(glyphPolygons, transform);
    meshRef.current = handle;
    return () => {
      handle.dispose();
      meshRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef]);

  useEffect(() => {
    meshRef.current?.setPolygons(glyphPolygons);
  }, [glyphPolygons]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.setTransform(transform);
    sceneRef.current?.rerender();
  }, [sceneRef, transform]);

  const computedClassName = `glyph-three-mesh${className ? ` ${className}` : ""}`;

  return (
    <div
      data-glyph-mesh-id={id}
      className={computedClassName}
      style={style}
    >
      {children}
    </div>
  );
}

export const GlyphThreeMesh = memo(GlyphThreeMeshInner);
