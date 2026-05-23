import { useEffect } from "react";
import type { DroppedModelSource, PresetModel } from "../types";

export interface UsePresetLoaderOptions {
  selectedPreset: PresetModel;
  selectedDroppedSource: DroppedModelSource | null;
  onMeshUrl: (url: string) => void;
  onSceneDefaults: (zoom: number | undefined, rotX: number | undefined, rotY: number | undefined) => void;
  autoZoomPresetRef: React.RefObject<string | null>;
}

// The actual model loading (fetch + parse) happens inside the GlyphScene
// runtime. This hook's job is to resolve the URL and per-preset camera
// defaults and push them into state when the selection changes.
export function usePresetLoader({
  selectedPreset,
  selectedDroppedSource,
  onMeshUrl,
  onSceneDefaults,
  autoZoomPresetRef,
}: UsePresetLoaderOptions): void {
  useEffect(() => {
    // Primitives carry no URL — GlyphScene reads the preset directly via
    // selectedPreset and calls setPolygons(). We still call onMeshUrl so the
    // meshUrl state stays in sync (GlyphScene uses selectedPreset.id to detect
    // the primitive branch, not the URL value).
    if (selectedPreset.kind !== "primitive") {
      const url = selectedDroppedSource
        ? URL.createObjectURL(selectedDroppedSource.primaryFile)
        : selectedPreset.url;

      onMeshUrl(url);

      if (autoZoomPresetRef.current !== selectedPreset.id) {
        autoZoomPresetRef.current = selectedPreset.id;
        onSceneDefaults(selectedPreset.zoom, selectedPreset.rotX, selectedPreset.rotY);
      }

      return () => {
        if (selectedDroppedSource) {
          URL.revokeObjectURL(url);
        }
      };
    }

    // Primitive path: no URL fetch needed.
    if (autoZoomPresetRef.current !== selectedPreset.id) {
      autoZoomPresetRef.current = selectedPreset.id;
      onSceneDefaults(selectedPreset.zoom, selectedPreset.rotX, selectedPreset.rotY);
    }
  }, [selectedPreset.id, selectedDroppedSource?.id]);
}
