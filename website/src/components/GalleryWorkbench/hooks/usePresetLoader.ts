import { useEffect } from "react";
import { loadMesh, type LoadMeshOptions } from "@glyphcss/core";
import type { DroppedModelSource, PresetModel } from "../types";
import { defaultZoomForModel } from "../helpers/smartDefaults";

export interface UsePresetLoaderOptions {
  selectedPreset: PresetModel;
  selectedDroppedSource: DroppedModelSource | null;
  onMeshUrl: (url: string) => void;
  onSceneDefaults: (zoom: number | undefined, rotX: number | undefined, rotY: number | undefined) => void;
  autoZoomPresetRef: React.RefObject<string | null>;
}

function loadOptionsForPreset(preset: PresetModel, url: string, mtlUrl?: string): LoadMeshOptions {
  const options = preset.options;
  return {
    baseUrl: url,
    ...(mtlUrl ? { mtlUrl } : {}),
    ...(preset.kind === "obj" && options ? { objOptions: options as LoadMeshOptions["objOptions"] } : {}),
    ...((preset.kind === "glb" || preset.kind === "gltf") && options ? { gltfOptions: options as LoadMeshOptions["gltfOptions"] } : {}),
    ...(preset.kind === "vox" && options ? { voxOptions: options as LoadMeshOptions["voxOptions"] } : {}),
    ...(preset.kind === "stl" && options ? { stlOptions: options as LoadMeshOptions["stlOptions"] } : {}),
  };
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
    let cancelled = false;

    const applySceneDefaults = async (
      preset: PresetModel,
      url?: string,
      mtlUrl?: string,
    ): Promise<void> => {
      let zoom = preset.zoom;
      try {
        const polygons = preset.kind === "primitive"
          ? preset.generatePolygons()
          : (await loadMesh(url ?? preset.url, loadOptionsForPreset(preset, url ?? preset.url, mtlUrl))).polygons;
        zoom = defaultZoomForModel(preset, polygons);
      } catch {
        zoom = defaultZoomForModel(preset);
      }
      if (!cancelled) onSceneDefaults(zoom, preset.rotX, preset.rotY);
    };

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
        void applySceneDefaults(selectedPreset, url, selectedPreset.mtlUrl);
      }

      return () => {
        cancelled = true;
        if (selectedDroppedSource) {
          URL.revokeObjectURL(url);
        }
      };
    }

    // Primitive path: no URL fetch needed.
    if (autoZoomPresetRef.current !== selectedPreset.id) {
      autoZoomPresetRef.current = selectedPreset.id;
      void applySceneDefaults(selectedPreset);
    }
    return () => {
      cancelled = true;
    };
  }, [selectedPreset.id, selectedDroppedSource?.id]);
}
