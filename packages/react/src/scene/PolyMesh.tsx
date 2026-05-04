/**
 * PolyMesh — load a mesh URL (or accept a polygons array) and render its
 * polygons inside a `.polycss-mesh` wrapper that carries the mesh-wide
 * position/scale/rotation transform. Per §API freeze and §Design.4c.
 *
 * Uses nested DOM (preserve-3d) so the wrapper transform composes with each
 * child <Poly>'s vertex matrix3d via CSS without JS doing the matrix math.
 *
 * Render-prop semantics (per §2a "Render-prop semantics"):
 *   - `children(polygon, index)` is called once per parsed polygon.
 *   - Returned elements render INSIDE the .polycss-mesh wrapper, so they
 *     inherit the mesh transform automatically. Don't re-apply position
 *     or you'll double-transform.
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  Polygon,
  Vec3,
} from "@polycss/core";
import { computeSceneBbox } from "@polycss/core";
import { Poly } from "../shapes";
import type { TransformProps } from "../shapes/types";
import { useMesh, type UseMeshOptions } from "./useMesh";

export interface PolyMeshProps extends TransformProps {
  /** URL to .obj / .glb / .gltf. Mutually exclusive with `polygons`. */
  src?: string;
  /**
   * Companion `.mtl` URL for OBJ models. When set, materials defined in
   * the mtl (Kd colors, map_Kd textures) are applied to the loaded mesh.
   * Ignored for GLB/GLTF (they carry materials inline).
   */
  mtl?: string;
  /** Pre-parsed polygons. Mutually exclusive with `src`. */
  polygons?: Polygon[];
  /** Translate so mesh's bbox center is at local origin before applying `position`. */
  autoCenter?: boolean;
  /** Per-polygon override render. Receives the polygon + its index. */
  children?: (polygon: Polygon, index: number) => ReactNode;
  /** Loading slot — rendered while `src` is being fetched/parsed. */
  fallback?: ReactNode;
  /** Error slot — rendered if parse fails. Receives the Error. */
  errorFallback?: (error: Error) => ReactNode;
  /** Parser options forwarded to parseObj/parseGltf. */
  parseOptions?: UseMeshOptions;
  className?: string;
  style?: CSSProperties;
}

function buildTransform(
  position: Vec3 | undefined,
  scale: number | Vec3 | undefined,
  rotation: Vec3 | undefined
): string | undefined {
  const parts: string[] = [];
  if (position) {
    parts.push(`translate3d(${position[0]}px, ${position[1]}px, ${position[2]}px)`);
  }
  if (scale !== undefined) {
    if (typeof scale === "number") {
      if (scale !== 1) parts.push(`scale3d(${scale}, ${scale}, ${scale})`);
    } else {
      parts.push(`scale3d(${scale[0]}, ${scale[1]}, ${scale[2]})`);
    }
  }
  if (rotation) {
    if (rotation[0]) parts.push(`rotateX(${rotation[0]}deg)`);
    if (rotation[1]) parts.push(`rotateY(${rotation[1]}deg)`);
    if (rotation[2]) parts.push(`rotateZ(${rotation[2]}deg)`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function recenterPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  const bbox = computeSceneBbox(polygons);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  if (cx === 0 && cy === 0 && cz === 0) return polygons;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(
      (v): Vec3 => [v[0] - cx, v[1] - cy, v[2] - cz]
    ),
  }));
}

export function PolyMesh({
  src,
  mtl,
  polygons: polygonsProp,
  autoCenter,
  children,
  fallback,
  errorFallback,
  parseOptions,
  position,
  scale,
  rotation,
  className,
  style,
}: PolyMeshProps) {
  // Compose mtl prop into the parser options threaded to useMesh.
  const mergedOptions = useMemo<UseMeshOptions | undefined>(() => {
    if (!mtl && !parseOptions) return undefined;
    return { ...(parseOptions ?? {}), ...(mtl ? { mtlUrl: mtl } : {}) };
  }, [mtl, parseOptions]);

  // Either fetch via useMesh, or use the supplied polygons array.
  // useMesh tolerates an empty src (sits idle) so we always call it for
  // hook-rules consistency.
  const fetched = useMesh(src ?? "", mergedOptions);

  const sourcePolygons = src ? fetched.polygons : (polygonsProp ?? []);

  // Re-center vertices into mesh-local space if autoCenter is set. Done
  // once per polygon-list identity — bake into vertices, not per frame.
  const polygons = useMemo(
    () => (autoCenter ? recenterPolygons(sourcePolygons) : sourcePolygons),
    [sourcePolygons, autoCenter]
  );

  const transform = buildTransform(position, scale, rotation);
  const wrapperStyle: CSSProperties = {
    position: "absolute",
    transformStyle: "preserve-3d",
    transform,
    ...style,
  };

  // Loading + error slots only apply when we're fetching from `src`.
  if (src) {
    if (fetched.loading && fetched.polygons.length === 0) {
      return (
        <div
          className={`polycss-mesh polycss-mesh-loading${className ? ` ${className}` : ""}`}
          style={wrapperStyle}
        >
          {fallback ?? null}
        </div>
      );
    }
    if (fetched.error && fetched.polygons.length === 0) {
      return (
        <div
          className={`polycss-mesh polycss-mesh-error${className ? ` ${className}` : ""}`}
          style={wrapperStyle}
        >
          {errorFallback ? errorFallback(fetched.error) : null}
        </div>
      );
    }
  }

  return (
    <div
      className={`polycss-mesh${className ? ` ${className}` : ""}`}
      style={wrapperStyle}
    >
      {polygons.map((p, i) =>
        children ? (
          // Render-prop: caller controls how each polygon renders. We still
          // wrap in a fragment with key so React reconciliation works.
          <RenderPropPolygon key={i} polygon={p} index={i}>
            {children}
          </RenderPropPolygon>
        ) : (
          <Poly
            key={i}
            vertices={p.vertices}
            color={p.color}
            texture={p.texture}
            uvs={p.uvs}
            data={p.data}
          />
        )
      )}
    </div>
  );
}

// Helper component so the render-prop call sits inside React's tree (vs. an
// inline call in the parent's render) — keeps key handling consistent and
// makes profiler output more readable.
function RenderPropPolygon({
  polygon,
  index,
  children,
}: {
  polygon: Polygon;
  index: number;
  children: (polygon: Polygon, index: number) => ReactNode;
}) {
  return <>{children(polygon, index)}</>;
}
