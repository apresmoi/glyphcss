import { useCallback, useState } from "react";
import { buildTurntableSvg } from "../../features/gallery/export/sceneExport";
import type { PresetModel, SceneOptionsState } from "../../features/gallery/model/types";
import { downloadSvgText } from "../../services/export/glyphSvgExport";
import { ActionButton } from "../ActionButton";

interface TurntableSvgButtonProps {
  selectedPreset: PresetModel;
  options: SceneOptionsState;
}

/**
 * Bakes the scene's full turn into one SVG that animates as an image, for
 * places that strip scripts and styles (a README, an issue, an email).
 */
export function TurntableSvgButton({ selectedPreset, options }: TurntableSvgButtonProps) {
  const [state, setState] = useState<"idle" | "busy" | "downloaded" | "error">("idle");

  const handleDownload = useCallback(async () => {
    setState("busy");
    try {
      const svg = await buildTurntableSvg(selectedPreset, options);
      downloadSvgText(svg, `${selectedPreset.id}-turntable.svg`);
      setState("downloaded");
    } catch (error) {
      console.error("glyphcss: animated SVG export failed", error);
      setState("error");
    }
    setTimeout(() => setState("idle"), 1200);
  }, [selectedPreset, options]);

  return (
    <ActionButton
      type="button"
      className="gw-code-panel__action"
      onClick={handleDownload}
      disabled={state === "busy"}
      title="Download a rotating SVG. It animates wherever an image is shown, with no script."
    >
      {state === "busy"
        ? "Rendering"
        : state === "downloaded"
          ? "Downloaded"
          : state === "error"
            ? "Download failed"
            : "Animated SVG"}
    </ActionButton>
  );
}
