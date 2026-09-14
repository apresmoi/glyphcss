/**
 * GlyphObject — mounts a `GlyphSceneObject` (PLAN-3d.md §3.1) into the
 * parent GlyphScene via `scene.addObject()`. Thin — the object's meshes,
 * overlays, hotspots and samplers are the producer's data; this component
 * only owns the mount lifecycle and the OBJECT's transform (position /
 * rotation / scale), mirroring GlyphMesh's own transform handling.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { Vec3 } from "@glyphcss/core";
import type { GlyphSceneObject, GlyphSceneObjectHandle, GlyphSceneObjectTransform } from "glyphcss";
import { useGlyphSceneContext } from "./context";

export interface GlyphObjectProps {
  object: GlyphSceneObject;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}

function GlyphObjectInner({ object, position, scale, rotation }: GlyphObjectProps): null {
  const { sceneRef } = useGlyphSceneContext();
  const handleRef = useRef<GlyphSceneObjectHandle | null>(null);

  const transform = useMemo<GlyphSceneObjectTransform>(
    () => ({ position, scale, rotation }),
    [position, scale, rotation],
  );

  // Mount once per scene — mirrors GlyphMesh's own `add`/`dispose` effect.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.addObject(object, transform);
    handleRef.current = handle;
    return () => {
      handle.remove();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef]);

  useEffect(() => {
    handleRef.current?.update(object);
  }, [object]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.setTransform(transform);
    sceneRef.current?.rerender();
  }, [sceneRef, transform]);

  return null;
}

export const GlyphObject = memo(GlyphObjectInner);
