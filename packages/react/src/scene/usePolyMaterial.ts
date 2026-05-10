import { useMemo } from "react";
import type { PolyMaterial } from "@layoutit/polycss-core";

/**
 * usePolyMaterial — memoizes a shared material handle so the same
 * (texture, key) inputs always return a stable object reference.
 *
 * Stable references matter for <Poly memo> shallow-compare: if the material
 * object identity is stable, tiles that share the same material won't
 * re-render just because a parent re-rendered.
 *
 * Future: additional material props (color tint, opacity, blend, lighting
 * overrides) will live here.
 */
export function usePolyMaterial(options: {
  texture: string;
  key?: string;
}): PolyMaterial {
  return useMemo(
    () => ({ texture: options.texture, key: options.key }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.texture, options.key],
  );
}
