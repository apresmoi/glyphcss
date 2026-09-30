import type { GlyphInteraction, GlyphStaticEncoding } from "glyphcss";
import { buildGlyphFramesExport, buildGlyphInteractiveExport, glyphCodepenPrefill } from "glyphcss";
import { useCallback, useMemo, useState } from "react";
import {
  buildStaticPen,
  generateSnippets,
  INTERACTION_LIST,
  liveGridMetrics,
  loadExportPolygons,
  postToCodepen,
  toRuntimeZoom,
} from "../../../features/gallery/export/sceneExport";
import { type GalleryEffectDefinition } from "../../../features/gallery/model/effects";
import type { GalleryEffectState, PresetModel, SceneOptionsState } from "../../../features/gallery/model/types";
import { BracketSelect } from "../../BracketSelect";
import { ChoiceButton } from "../../IconToggle";
import { CodePanel } from "../../CodePanel";

interface GalleryCodePanelProps {
  meshUrl: string;
  options: SceneOptionsState;
  selectedPreset: PresetModel;
  effectState: GalleryEffectState;
  effectDefinition: GalleryEffectDefinition | null;
  className?: string;
  id?: string;
  onClose: () => void;
}

export function GalleryCodePanel({
  meshUrl,
  options,
  selectedPreset,
  effectState,
  effectDefinition,
  className,
  id,
  onClose,
}: GalleryCodePanelProps) {
  const snippets = useMemo(
    () => generateSnippets({ meshUrl, options, selectedPreset, effectState, effectDefinition }),
    [meshUrl, options, selectedPreset, effectState, effectDefinition],
  );
  const [interactions, setInteractions] = useState<Set<GlyphInteraction>>(() => new Set(["orbit", "zoom"]));
  const [staticMode, setStaticMode] = useState(false);
  const [staticEncoding, setStaticEncoding] = useState<GlyphStaticEncoding>("classes");
  const [rotate, setRotate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toggleInteraction = useCallback((k: GlyphInteraction) => {
    setStaticMode(false); // choosing an interaction means it's not a static export
    setInteractions((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  // Compile the current model + chosen interactions into a self-contained,
  // decimated glyphcss snippet and open it as a new CodePen. Polygons are loaded
  // from the same source the gallery uses (URL mesh or built-in primitive).
  const handleCodepen = useCallback(async () => {
    setExporting(true);
    try {
      const title = (selectedPreset as { label?: string }).label ?? "glyphcss";
      const projection = options.perspective === false ? ("orthographic" as const) : ("perspective" as const);
      const perspectivePx = options.perspective === false ? undefined : options.perspective;

      // Static mode.
      if (staticMode) {
        // Static + rotate: bake a turntable of frames → pure-CSS steps() loop.
        // No mesh, no glyphcss runtime — just pre-rendered text frames.
        if (rotate) {
          const { polygons } = await loadExportPolygons(selectedPreset);
          const g = liveGridMetrics();
          const frames = buildGlyphFramesExport(polygons, {
            frameCount: 36,
            rotX: options.rotX,
            rotY: options.rotY,
            zoom: toRuntimeZoom(options.zoom ?? 0.35),
            projection,
            perspectivePx,
            // pad the grid so the silhouette doesn't clip as it turns
            cols: Math.round(g.cols * 1.3),
            rows: Math.round(g.rows * 1.3),
            lineHeightPx: g.lineHeightPx,
            fontSizePx: g.fontSizePx,
            mode: options.renderMode === "wireframe" || options.renderMode === "ink" ? options.renderMode : "solid",
            useColors: options.useColors,
            autoCenter: true,
          });
          postToCodepen({
            action: "https://codepen.io/pen/define",
            data: JSON.stringify({ title, ...frames.pen, editors: "110" }),
          });
          return;
        }
        // Static (single frame): ship the live-rendered <pre> as-is.
        const pen = buildStaticPen(staticEncoding);
        if (!pen) {
          console.warn("glyphcss: no rendered frame to export");
          return;
        }
        postToCodepen({
          action: "https://codepen.io/pen/define",
          data: JSON.stringify({ title, ...pen, editors: "100" }),
        });
        return;
      }

      const { polygons, textured } = await loadExportPolygons(selectedPreset);
      const decimateGrid = textured ? 100000 : undefined; // textured → keep baked color detail
      const result = buildGlyphInteractiveExport(polygons, {
        interactions: [...interactions],
        rotX: options.rotX,
        rotY: options.rotY,
        zoom: toRuntimeZoom(options.zoom ?? 0.35),
        // Match the gallery's projection (it defaults to orthographic) so the
        // export frames identically and map-controls pan tracks correctly.
        projection,
        perspectivePx,
        autoCenter: true,
        mode: options.renderMode === "wireframe" || options.renderMode === "ink" ? options.renderMode : "solid",
        useColors: options.useColors,
        decimateGrid,
        effect: effectState.effectId
          ? {
              id: effectState.effectId,
              params: effectState.params,
              blend: effectState.blend,
              timeScale: effectState.paused ? 0 : effectState.timeScale,
            }
          : undefined,
      });
      postToCodepen(glyphCodepenPrefill(result, title));
    } catch (err) {
      console.error("glyphcss: CodePen export failed", err);
    } finally {
      setExporting(false);
    }
  }, [meshUrl, selectedPreset, options, interactions, staticMode, staticEncoding, rotate, effectState]);

  return (
    <CodePanel
      id={id}
      className={className}
      snippets={snippets}
      onClose={onClose}
      codepen={{ onClick: handleCodepen, busy: exporting }}
      settings={
        <details className="gw-code-panel__settings">
          <summary>CodePen options</summary>
          <div className="gw-code-panel__options">
            <ChoiceButton aria-pressed={staticMode} onClick={() => setStaticMode((v) => !v)}>
              Static
            </ChoiceButton>
            {staticMode && (
              <ChoiceButton aria-pressed={rotate} onClick={() => setRotate((v) => !v)}>
                Auto-rotate
              </ChoiceButton>
            )}
            {staticMode && !rotate && (
              <BracketSelect
                aria-label="Static encoding"
                value={staticEncoding}
                onChange={(e) => setStaticEncoding(e.target.value as GlyphStaticEncoding)}
              >
                <option value="classes">classes</option>
                <option value="grid">grid</option>
                <option value="inline">inline</option>
              </BracketSelect>
            )}
            {INTERACTION_LIST.map(({ key, label }) => (
              <ChoiceButton
                key={key}
                disabled={staticMode}
                title={staticMode ? "Interactions need a live export" : label}
                aria-pressed={!staticMode && interactions.has(key)}
                onClick={() => toggleInteraction(key)}
              >
                {label}
              </ChoiceButton>
            ))}
          </div>
        </details>
      }
    />
  );
}
