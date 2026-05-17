/**
 * Rendering folder — render mode, feature-edge threshold, glyph palette,
 * line-height multiplier, and colors toggle.
 */
import type { GUI } from "lil-gui";
import type { SceneOptionsState } from "../../GalleryWorkbench/types";
import { useFolder, useOption, useSlider, useToggle } from "../primitives";

export interface RenderingFolderInputs {
  renderMode: SceneOptionsState["renderMode"];
  featureEdges: number;
  glyphPalette: SceneOptionsState["glyphPalette"];
  lineHeight: number;
  useColors: boolean;
  onUpdateScene: (partial: Partial<Pick<SceneOptionsState, "renderMode" | "featureEdges" | "glyphPalette" | "lineHeight" | "useColors">>) => void;
}


const RENDER_MODE_OPTIONS: Record<string, "wireframe" | "solid"> = {
  Wireframe: "wireframe",
  Solid: "solid",
};
type GlyphPaletteId = "default" | "ascii" | "dots" | "lines" | "blocks" | "stars" | "arrows" | "braille" | "runes" | "math" | "binary" | "hex";
const GLYPH_PALETTE_OPTIONS: Record<string, GlyphPaletteId> = {
  Default: "default",
  ASCII: "ascii",
  Dots: "dots",
  Lines: "lines",
  Blocks: "blocks",
  Stars: "stars",
  Arrows: "arrows",
  Braille: "braille",
  Runes: "runes",
  Math: "math",
  Binary: "binary",
  Hex: "hex",
};

export function useRenderingFolder(parent: GUI | null, inputs: RenderingFolderInputs): void {
  const { renderMode, featureEdges, glyphPalette, lineHeight, useColors, onUpdateScene } = inputs;
  const folder = useFolder(parent, "Rendering", { open: true });

  useOption<"wireframe" | "solid">(folder, "Render mode", RENDER_MODE_OPTIONS, renderMode, (value) =>
    onUpdateScene({ renderMode: value }),
  );
  useSlider(folder, "Feature edges °", { min: 0, max: 90, step: 1 }, featureEdges, (value) =>
    onUpdateScene({ featureEdges: value }),
  );
  useOption<GlyphPaletteId>(folder, "Glyph palette", GLYPH_PALETTE_OPTIONS, glyphPalette as GlyphPaletteId, (value) =>
    onUpdateScene({ glyphPalette: value }),
  );
  useToggle(folder, "Colors", useColors, (value) =>
    onUpdateScene({ useColors: value }),
  );
  useSlider(folder, "Line-height ×", { min: 0.5, max: 1.2, step: 0.01 }, lineHeight, (value) =>
    onUpdateScene({ lineHeight: value }),
  );
}
