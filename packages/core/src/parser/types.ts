/**
 * Unified parser return type. All polygon-emitting parsers (parseObj,
 * parseGltf, the loadMesh dispatcher) return this exact shape.
 *
 * The asymmetric helper `parseMtl` returns its own `MtlParseResult` (it
 * emits materials, not polygons) — see parseMtl.ts for the rationale.
 *
 * Lifecycle contract: callers MUST call `dispose()` when the result is no
 * longer needed. Idempotent — safe to call on unmount even if `objectUrls`
 * is empty (e.g. `parseObj`, where it's a no-op).
 */
import type { Polygon } from "../types";

export interface ParseAnimationClip {
  /** Stable numeric index in the source file's animation array. */
  index: number;
  /** Human-readable clip name. Falls back to `animation_N` when omitted. */
  name: string;
  /** Clip duration in seconds, derived from its sampler input accessors. */
  duration: number;
  /** Number of glTF animation channels in the clip. */
  channelCount: number;
}

export interface ParseAnimationController {
  /** Animation clips exposed by the parsed mesh. Empty when none are usable. */
  clips: ParseAnimationClip[];
  /**
   * Sample a clip at `timeSeconds` and return a fresh polygon list.
   * `clip` accepts either the clip index or its name. Time wraps by duration.
   */
  sample: (clip: number | string, timeSeconds: number) => Polygon[];
}

export interface ParseResult {
  /** The mesh, as a flat polygon list. Already vertex-permuted to polycss space. */
  polygons: Polygon[];
  /** Optional animation sampler for formats that carry timeline data. */
  animation?: ParseAnimationController;
  /**
   * Blob/object URLs minted during parse (e.g. embedded GLB images). Pass-by-
   * reference — the same array is exposed on the result for visibility, and
   * `dispose()` revokes each one. Do NOT mutate this array externally.
   */
  objectUrls: string[];
  /**
   * Idempotent — revokes object URLs. Safe to call on unmount, safe to call
   * twice. Parsers without minted URLs (parseObj, parseMtl) supply a no-op.
   */
  dispose: () => void;
  /**
   * Non-fatal warnings raised during parse. Empty for parsers that don't
   * have a warning channel; populated when downstream `normalizePolygons`
   * is invoked through the high-level pipeline.
   */
  warnings: string[];
  /** Optional format-specific metadata. */
  metadata?: {
    /** Triangle count after fan-triangulation (parseObj) or post-triangulation (parseGltf). */
    triangleCount?: number;
    /** Mesh names from the file (for glTF, from doc.meshes[].name). */
    meshes?: string[];
    /** Material names (in first-seen order). */
    materials?: string[];
    /** Animation clips from the file, mirrored from `animation.clips`. */
    animations?: ParseAnimationClip[];
    /** Source file size in bytes (for diagnostics). */
    sourceBytes?: number;
  };
}
