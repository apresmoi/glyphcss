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
    const url = selectedDroppedSource
      ? URL.createObjectURL(selectedDroppedSource.primaryFile)
      : selectedPreset.url;

    onMeshUrl(url);

    if (autoZoomPresetRef.current !== selectedPreset.id) {
      autoZoomPresetRef.current = selectedPreset.id;
      // Pass through undefined when the preset doesn't override — the consumer
      // keeps its current DEFAULT_SCENE value rather than getting a stale fallback.
      onSceneDefaults(selectedPreset.zoom, selectedPreset.rotX, selectedPreset.rotY);
    }

    return () => {
      if (selectedDroppedSource) {
        URL.revokeObjectURL(url);
      }
    };
  }, [selectedPreset.id, selectedDroppedSource?.id]);
}
