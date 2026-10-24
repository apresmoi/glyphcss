import { SynthScope } from "../SynthScope";
import { sceneDefaultsForPresetId } from "../GalleryWorkbench";
import { createChartsWorkbenchState } from "../../features/charts/model/chartsSpec";
import {
  createGlyphDiagramsWorkbenchState,
  resolveGlyphDiagramsWorkbenchControls,
} from "../../features/diagrams/model/diagramsWorkbenchState";
import { resolveGlyphChartsWorkbenchControls } from "../../features/charts/model/chartsWorkbenchState";
import { MAPS_URL_DEFAULTS } from "../../features/maps/services/mapsUrlState";
import { SYNTH_PARAM_DEFAULTS, SYNTH_URL_DEFAULTS } from "../../features/synth/model/urlState";
import { DEFAULT_LOADER, findLoader } from "../../features/loaders/model/loaders";
import { synthPatchOf } from "../../features/loaders/model/patches";
import { DEFAULT_MAP_LIGHTING } from "../../features/maps/model/lighting";
import { WORD_ART_DEFAULTS } from "../../features/wordart/model/urlState";
import {
  StaticChoice as Choice,
  StaticChoices as Choices,
  StaticText as Text,
  StaticColor as Color,
  StaticSection as Section,
  StaticSlider as Slider,
  StaticToggle as Toggle,
} from "./StaticControls";

export type StaticWorkbenchPage = "gallery" | "synth" | "maps" | "wordart" | "loaders" | "charts" | "diagrams";

export function StaticPanels({ page }: { page: StaticWorkbenchPage }) {
  if (page === "charts" || page === "diagrams") {
    const diagrams = createGlyphDiagramsWorkbenchState();
    const charts = createChartsWorkbenchState();
    const controls =
      page === "charts"
        ? resolveGlyphChartsWorkbenchControls(charts.controls)
        : resolveGlyphDiagramsWorkbenchControls(diagrams.controls, diagrams.form);
    return (
      <>
        <Section title="Output">
          <Slider label="Width" value={controls.width} min={12} max={240} />
          <Slider label="Height" value={controls.height} min={6} max={120} />
          <Slider label="Density" value={1} min={0.5} max={4} />
          {page === "diagrams" && (
            <Choices label="Form" value={diagrams.form} options={{ graph: "Graph", sequence: "Sequence" }} />
          )}
          <Choices label="Target" value={controls.target} options={{ chat: "chat", terminal: "term", web: "web" }} />
          <Choices
            label="Charset"
            value={controls.charset}
            options={{ ascii: "#", box: "┼", blocks: "▓", braille: "⠿" }}
          />
          <Choices
            label="Color"
            value={controls.color}
            options={{ none: "off", ansi16: "16", ansi256: "256", truecolor: "rgb", css: "css" }}
          />
        </Section>
        {page === "diagrams" ? (
          <>
            <Section title="Layout">
              <Choice
                label="Direction"
                value={diagrams.layout.autoDirection ? "Auto" : (diagrams.layout.direction ?? "TB")}
              />
              <Choice label="Engine" value={diagrams.layout.engine} />
              <Slider label="nodesep" value={diagrams.layout.nodesep} min={3} max={24} />
              <Slider label="ranksep" value={diagrams.layout.ranksep} min={3} max={24} />
            </Section>
            <Section title="Diagram">
              <Text label="Title" value={diagrams.diagram.title} />
              <Choice label="Detail" value={diagrams.diagram.detail} />
            </Section>
          </>
        ) : (
          <>
            <Section title="Chart">
              <Text label="Title" value={charts.chart.title} />
              <Text label="Description" value={charts.chart.description} />
              <Toggle label="Legend" value={charts.chart.legend ?? true} />
              <Choices
                label="Title at"
                value={charts.chart.titleAlign}
                options={{ left: "Left", center: "Center", right: "Right" }}
              />
              <Choices
                label="Legend at"
                value={charts.chart.legendPlacement}
                options={{ top: "Top", right: "Right", bottom: "Bottom", left: "Left" }}
              />
            </Section>
            <Section title="Scales">
              <Choice label="X type" value={charts.scales.x.type} />
              <Choice label="Y type" value={charts.scales.y.type} />
            </Section>
            <Section title="Axes">
              {(["x", "y"] as const).map((axis) => (
                <Section key={axis} title={`${axis.toUpperCase()} axis`}>
                  <Text label={`${axis.toUpperCase()} title`} value={charts.axes[axis].title} />
                  <Slider label={`${axis.toUpperCase()} ticks`} value={charts.axes[axis].ticks} max={20} />
                  <Section title="More" />
                </Section>
              ))}
            </Section>
          </>
        )}
      </>
    );
  }
  if (page === "synth" || page === "loaders") {
    const p = page === "loaders" ? synthPatchOf(findLoader(DEFAULT_LOADER)) : SYNTH_PARAM_DEFAULTS;
    return (
      <>
        <Section title="Stage">
          {page === "synth" && (
            <>
              <Choice label="Shape" value="Plane" />
              <Choice label="Mapping" value={String(p.space)} />
            </>
          )}
          <Slider
            label={page === "loaders" ? "Cell size" : "Density"}
            value={page === "loaders" ? 11 : 1}
            min={page === "loaders" ? 6 : 0.5}
            max={page === "loaders" ? 24 : 4}
          />
          <Slider label="Speed" value={page === "loaders" ? 1 : SYNTH_URL_DEFAULTS.timeScale} min={0.05} max={8} />
          <Toggle label="Paused" value={false} />
        </Section>
        <Section title="Mix">
          <SynthScope paramsRef={{ current: p }} tsRef={{ current: 1 }} pausedRef={{ current: true }} />
          {page === "loaders" && <Choice label="Mapping" value={String(p.space)} />}
          <Choice label="Combine" value={String(p.combine)} />
          <Slider label="Scale" value={Number(p.scale)} max={8} />
          <Slider label="Origin U" value={Number(p.originU)} />
          <Slider label="Origin V" value={Number(p.originV)} />
          <Slider label="Contrast" value={Number(p.gain)} max={4} />
          <Slider label="Brightness" value={Number(p.bias)} min={-1} max={2} />
        </Section>
        <Section title="Output">
          <Choices label="Subcell" value={String(p.subcellRes)} options={{ "1x1": "1×1", "2x4": "2×4", ink: "Ink" }} />
          <Choice label="Ramp" value="Custom" />
          <Text label="Chars" value={String(p.glyphs)} />
          <Toggle label="Per-voice colors" value={p.voiceColors === true} />
          <Color label="Color" value={String(p.color)} />
          <Color label="Color B" value={String(p.colorB)} />
          <Slider label="Gradient" value={Number(p.gradient)} />
          <Slider label="Color tolerance" value={SYNTH_URL_DEFAULTS.colorTolerance} max={96} />
          <Choices label="Color encoding" value="spans" options={{ spans: "Spans", atlas: "Atlas" }} />
        </Section>
        <Section title="Lighting" />
      </>
    );
  }
  if (page === "wordart") {
    const d = WORD_ART_DEFAULTS;
    return (
      <>
        <Section title="Shape">
          <Choice label="Profile" value={d.profile} />
          <Choice label="Warp" value={d.warpShape} />
        </Section>
        <Section title="Layout">
          <Slider label="Depth" value={d.depth} min={2} max={80} />
          <Slider label="Scale X" value={d.scaleX} min={40} max={200} />
          <Slider label="Scale Y" value={d.scaleY} min={40} max={200} />
          <Slider label="Curve segments" value={d.curveSegments} min={1} max={12} />
          <Slider label="Simplify" value={d.simplify} max={8} />

          <Slider label="Layer offset" value={d.offset} max={32} />
          <Toggle label="Flat layers" value={d.layered} />
        </Section>
        <Section title="Render">
          <Choice label="Render mode" value={d.renderMode} />
          <Choice label="Character mode" value={d.charMode} />
          <Slider label="Density" value={d.density} min={0.5} max={4} />
          <Choices label="Color encoding" value="spans" options={{ spans: "Spans", atlas: "Atlas" }} />
        </Section>
        <Section title="Effects">
          <Choice label="Effect" value="None" />
          <Choice label="Composition" value="Replace" />
          <Toggle label="Paused" value={false} />
          <Slider label="Playback speed" value={1} min={0.05} max={8} />
        </Section>
        <Section title="Camera" />
        <Section title="Lighting" />
      </>
    );
  }
  const d = sceneDefaultsForPresetId("primitive-tetrahedron");
  const m = MAPS_URL_DEFAULTS;
  return (
    <>
      {page === "maps" && (
        <Section title="View">
          <Choice label="Projection" value={m.projection} />
          <Slider label="Center lon" value={m.centerLon} min={-180} max={180} />
          <Slider label="Center lat" value={m.centerLat} min={-90} max={90} />
          <Slider label="Span °" value={m.span} max={360} />
          <Slider label="Tilt °" value={0} max={90} />
          <Slider label="Bearing °" value={0} max={360} />
        </Section>
      )}
      <Section title="Rendering">
        {page === "gallery" && (
          <>
            <Choice label="Render mode" value="Solid" />
            <Slider label="Feature edges °" value={d.featureEdges} max={90} />
            <Choice label="Glyph palette" value="Default" />
          </>
        )}
        <Choice label="Character mode" value="ASCII" />
        <Toggle label="Box junctions (wireframe)" value={d.wireframeJunctions} />
        <Choice label="Hidden lines" value="Show" />
        <Toggle label="Weighted shading" value={d.solidWeightRamp} />
        <Choices label="Color encoding" value="spans" options={{ spans: "Spans", atlas: "Atlas" }} />
        <Toggle label="Colors" value={true} />
        <Toggle label="Smooth shading" value={page === "maps" ? m.smoothShading : d.smoothShading} />
        {page === "gallery" && <Slider label="Crease angle °" value={d.creaseAngle} max={180} />}
        {page === "gallery" && <Slider label="Density ×" value={d.density} min={0.5} max={4} />}
        <Slider label="Drag density ×" value={d.dragDensity} min={0.1} max={1} />
      </Section>
      {page === "gallery" && (
        <>
          <Section title="Effects">
            <Choice label="Effect" value="None" />
            <Choice label="Composition" value="Replace" />
            <Toggle label="Paused" value={false} />
            <Slider label="Playback speed" value={1} min={0.05} max={8} />
          </Section>
          <Section title="Camera" />
        </>
      )}
      <Section title="Lighting">
        {page === "maps" && (
          <>
            <Choice label="Sun" value="Full" />
            <Toggle label="Shadows" value={m.shadows} />
          </>
        )}
        <Slider
          label="Azimuth"
          value={page === "maps" ? DEFAULT_MAP_LIGHTING.lightAzimuth : d.lightAzimuth}
          max={360}
        />
        <Slider
          label="Elev."
          value={page === "maps" ? DEFAULT_MAP_LIGHTING.lightElevation : d.lightElevation}
          min={-90}
          max={90}
        />
        <Slider label="Key" value={page === "maps" ? DEFAULT_MAP_LIGHTING.lightIntensity : d.lightIntensity} max={2} />
        <Color label="Key color" value={page === "maps" ? DEFAULT_MAP_LIGHTING.lightColor : d.lightColor} />
        <Slider
          label="Ambient"
          value={page === "maps" ? DEFAULT_MAP_LIGHTING.ambientIntensity : d.ambientIntensity}
          max={2}
        />
        <Color label="Amb. color" value={page === "maps" ? DEFAULT_MAP_LIGHTING.ambientColor : d.ambientColor} />
      </Section>
      {page === "gallery" && <Section title="Shadow" />}
    </>
  );
}

export function StaticWordArtRail() {
  const d = WORD_ART_DEFAULTS;
  return (
    <>
      <Section title="Typography">
        <Choice label="Weight" value={d.weight} />
        <Toggle label="Italic" value={d.italic} />
        <Toggle label="Underline" value={d.underline} />
        <Toggle label="Strikethrough" value={d.strike} />
        <Choice label="Case" value={d.textCase} />
        <Choice label="Align" value={d.align} />
        <Slider label="Letter spacing" value={d.letterSpacing} min={-20} max={40} />
        <Slider label="Line height" value={d.lineHeight} min={0.5} max={3} />
      </Section>
      <Section title="Color">
        <Choice label="Front" value={d.fillType} />
        <Color label="Color" value={d.color} />
        <Choice label="Sides" value={d.sideFill} />
        <Color label="Side color" value={d.sideColor} />
        <Choice label="Back" value={d.backFill} />
        <Color label="Back color" value={d.backColor} />
        <Toggle label="Outline" value={d.outlineOn} />
        <Color label="Outline color" value={d.outlineColor} />
        <Slider label="Outline width" value={d.outlineWidth} min={0.5} max={12} />
      </Section>
    </>
  );
}
