import {
  type MapProjectionId,
  type MapSunMode,
  MAP_SCENE_GLYPH_PALETTE,
  MAP_SCENE_RENDER_MODE,
} from "../../features/maps/model/config";
import { type MapLighting, mapDirectionLocked } from "../../features/maps/model/lighting";
import { type MapCharMode, type MapColorEncoding } from "../../features/maps/services/mapsUrlState";
import { DockLighting, DockRendering, useDockGui } from "../Dock";
import { MapsProjectionControls } from "./MapsProjectionControls";
import { MapsShadowControls } from "./MapsShadowControls";
import { MapsSunControls } from "./MapsSunControls";
import { MAPS_CHAR_MODE_OPTIONS } from "./controllerHelpers";
import { useViewFolder } from "./hooks/useViewFolder";
import { type RenderingPartial } from "./types";

export function MapsDockFolders(props: {
  projectionId: MapProjectionId;
  onProjectionId: (id: MapProjectionId) => void;
  centerLon: number;
  centerLat: number;
  span: number;
  maxSpan: number;
  tilt: number;
  maxTilt: number;
  bearing: number;
  lod: number;
  degPerCell: number;
  onCenter: (lon: number, lat: number) => void;
  onSpan: (v: number) => void;
  onTilt: (v: number) => void;
  onBearing: (v: number) => void;
  charMode: MapCharMode;
  charModeReason: string | null;
  wireframeJunctions: boolean;
  hiddenLines: "show" | "hide";
  solidWeightRamp: boolean;
  colorEncoding: MapColorEncoding;
  atlasReason: string | null;
  density: number;
  dragDensity: number;
  useColors: boolean;
  smoothShading: boolean;
  onUpdateRendering: (partial: RenderingPartial) => void;
  lighting: MapLighting;
  onUpdateLighting: (partial: Partial<MapLighting>) => void;
  sunMode: MapSunMode;
  sunDay: number;
  sunHour: number;
  shadows: boolean;
  onShadows: (on: boolean) => void;
  /** {@link mapShadowCasterReason} — why the Shadows toggle would draw nothing, or `null`. */
  shadowCasterReason: string | null;
  onSunMode: (mode: MapSunMode) => void;
  onSunDay: (day: number) => void;
  onSunHour: (hour: number) => void;
}) {
  const gui = useDockGui();

  useViewFolder(gui, {
    centerLon: props.centerLon,
    centerLat: props.centerLat,
    span: props.span,
    maxSpan: props.maxSpan,
    tilt: props.tilt,
    maxTilt: props.maxTilt,
    bearing: props.bearing,
    isOrbitProjection: props.projectionId === "globe",
    lod: props.lod,
    degPerCell: props.degPerCell,
    onCenter: props.onCenter,
    onSpan: props.onSpan,
    onTilt: props.onTilt,
    onBearing: props.onBearing,
  });

  return (
    <>
      <MapsProjectionControls folder={gui} projectionId={props.projectionId} onProjectionId={props.onProjectionId} />
      {/*
        Several of `DockRendering`'s rows are hidden here rather than wired:
        Render mode, Density, Glyph palette, Feature edges, Crease angle. The
        folder is SHARED with /gallery (and, through it, every other page
        that mounts it), so each removal is an opt-out prop defaulting to
        today's behaviour — see `RenderingFolderInputs`' own docs for the
        per-row reasoning. The values below still have to be supplied because
        the folder computes real state from them: `renderMode` is genuinely
        this scene's mode and drives which OTHER rows are enabled (character
        mode, weighted shading, hidden lines), and `onRenderModeChange` cannot
        fire while its row is hidden; `glyphPalette` is the scene's real ramp,
        now set exclusively per-layer. `featureEdges`/`creaseAngle` are inert
        here — neither is forwarded to the map's scene.
      */}
      <DockRendering
        renderMode={MAP_SCENE_RENDER_MODE}
        showRenderMode={false}
        onRenderModeChange={() => {}}
        semanticAvailable={false}
        featureEdges={0}
        showFeatureEdges={false}
        // The scene's real (and now fixed) ramp — supplied because the
        // shared folder computes state from it, exactly as `renderMode` is.
        // The ROW itself has moved to the per-layer cards, hidden here with
        // the same opt-out `showRenderMode`/`showDensity` get.
        glyphPalette={MAP_SCENE_GLYPH_PALETTE}
        showGlyphPalette={false}
        charMode={props.charMode}
        charModeReason={props.charModeReason}
        charModeOptions={MAPS_CHAR_MODE_OPTIONS}
        wireframeJunctions={props.wireframeJunctions}
        hiddenLines={props.hiddenLines}
        solidWeightRamp={props.solidWeightRamp}
        colorEncoding={props.colorEncoding}
        atlasReason={props.atlasReason}
        density={props.density}
        dragDensity={props.dragDensity}
        // Maps exposes density per-layer instead (Terrain/Borders/Contour
        // cards in the left rail) — see `RenderingFolderInputs.showDensity`'s
        // doc for why a second scene-wide "Density" row in this Dock would
        // be a confusing duplicate. "Drag density" stays visible: it's an
        // interaction-performance knob, not a resolution knob.
        showDensity={false}
        useColors={props.useColors}
        smoothShading={props.smoothShading}
        creaseAngle={0}
        showCreaseAngle={false}
        onUpdateScene={props.onUpdateRendering}
      />
      <DockLighting
        lightAzimuth={props.lighting.lightAzimuth}
        lightElevation={props.lighting.lightElevation}
        lightIntensity={props.lighting.lightIntensity}
        lightColor={props.lighting.lightColor}
        ambientIntensity={props.lighting.ambientIntensity}
        ambientColor={props.lighting.ambientColor}
        // On an ORBIT projection SOMETHING usually owns the key light's
        // direction — the sun in Real time/Manual, the camera-following
        // headlight in Full — so Azimuth/Elev have nothing left to aim and
        // are dimmed with the reason rather than left live and silently
        // ignored. On a SHEET they still do real work in every mode (relief
        // hillshading; the sun's terminator there is a separate per-cell
        // term, and Full leaves the light alone because a flat map has no
        // dark hemisphere to fix), so they stay enabled.
        //
        // SHADOWS in Full mode are the exception, and the equivalence in
        // `mapsKit.sun.test.ts` is what keeps this row honest: a headlight
        // casts every shadow behind its own caster, so asking for shadows
        // drops it (`mapKeyLightForSunMode`) and the sliders become the only
        // thing aiming the light again — they must be live, or the reader has
        // shadows they cannot move.
        directionLocked={mapDirectionLocked(props.projectionId, props.sunMode, props.shadows)}
        directionLockedReason={
          props.sunMode === "off"
            ? "Full lights the globe from the camera, so the whole visible face stays lit — switch Sun to Manual to aim a light by hand."
            : "The sun owns the key light's direction in this mode — switch Sun to Manual to aim it by hand."
        }
        onUpdateScene={props.onUpdateLighting}
        extras={(folder) => (
          <>
            {/* Rendered FIRST so it lands BELOW the Sun row — each top slot
                is inserted before the folder's current first child, so the
                last one mounted ends up first. */}
            <MapsShadowControls
              folder={folder}
              shadows={props.shadows}
              onShadows={props.onShadows}
              casterReason={props.shadowCasterReason}
            />
            <MapsSunControls
              folder={folder}
              mode={props.sunMode}
              day={props.sunDay}
              hour={props.sunHour}
              onMode={props.onSunMode}
              onDay={props.onSunDay}
              onHour={props.onSunHour}
            />
          </>
        )}
      />
    </>
  );
}
