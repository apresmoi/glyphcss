import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createGlyphMap,
  GlyphMapClassifiers,
  type GlyphMapAttribution,
  type GlyphMapHandle,
  type GlyphMapProvider,
  type GlyphMapVectorProvider,
  type GlyphMapView,
} from "@glyphcss/maps";
import { injectGlyphBaseStyles } from "glyphcss";
import { Dock, DockLighting, DockRendering } from "../Dock";
import { useDockGui } from "../Dock/slots";
import type { GalleryRenderPresentation } from "../Dock/folders/useRenderingFolder";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import { createGeoTilesProvider } from "../../lib/geoTilesProvider";
import { createVectorTilesProvider } from "../../lib/vectorTilesProvider";
import { extractAsciiFromPre } from "../../lib/asciiClipboard";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { computeGlyphAtlasAvailability } from "../../lib/glyphAtlasAvailability";
import { getSolidWeightRamp } from "../GalleryWorkbench/weightedRamp";
import { StatsOverlay } from "../StatsOverlay";
import { AttributionCredit } from "../AttributionCredit/AttributionCredit";
import {
  InstrumentBody,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentShell,
  InstrumentViewport,
} from "../InstrumentWorkbench/InstrumentWorkbench";
import {
  MAP_PALETTES,
  buildMapLighting,
  buildMapProjection,
  buildMapsSnippet,
  loadContourField,
  loadMapPlaces,
  LayersPanel,
  paletteColorsFor,
  useProjectionFolder,
  useTerrainFolder,
  useViewFolder,
  type MapLighting,
  type MapPaletteName,
  type MapPlace,
  type MapProjectionId,
} from "./mapsKit";
import { readInitialMapsState, writeMapsUrlState, type MapCharMode, type MapColorEncoding, type MapGlyphPalette, type MapRenderMode } from "./mapsUrlState";
import "../GalleryWorkbench/gallery-workbench.css";
import "../InstrumentWorkbench/instrument-workbench.css";
import "./maps-workbench.css";

const BACKGROUND_LAYER_ID = "background";
const TERRAIN_LAYER_ID = "terrain";
const BORDER_LAYER_ID = "borders";
const CONTOUR_LAYER_ID = "contour";
const BASE_FONT_PX = 13;

export default function MapsWorkbench() {
  const initial = useMemo(() => readInitialMapsState(), []);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [stageHost, setStageHost] = useState<HTMLElement | null>(null);
  const mapRef = useRef<GlyphMapHandle | null>(null);
  const [provider, setProvider] = useState<GlyphMapProvider | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [places, setPlaces] = useState<readonly MapPlace[]>([]);
  const [vectorProvider, setVectorProvider] = useState<GlyphMapVectorProvider | null>(null);
  const [attributions, setAttributions] = useState<readonly GlyphMapAttribution[]>([]);

  // ── Per-layer visibility + density (left-rail "Layers" panel — user
  //    placement/uniformity ask: every layer, same shape, in the rail
  //    above Places, not the right Dock). Only `terrainDensity` is
  //    actually wired to the renderer this slice (raster's density passes
  //    straight through to glyphcss's own per-mesh detail layer); the
  //    other density sliders render disabled+dimmed — see mapsKit.tsx's
  //    `LayersPanel` doc for why stroke-layer density isn't wired yet. ──
  const [showBackground, setShowBackground] = useState(true);
  const [showTerrain, setShowTerrain] = useState(true);
  const [showBorders, setShowBorders] = useState(true);
  const [showContour, setShowContour] = useState(false);
  const [backgroundDensity, setBackgroundDensity] = useState(1);
  const [terrainDensity, setTerrainDensity] = useState(1);
  const [borderDensity, setBorderDensity] = useState(1);
  const [contourDensity, setContourDensity] = useState(1);
  const showBordersRef = useRef(showBorders);
  showBordersRef.current = showBorders;
  const showBackgroundRef = useRef(showBackground);
  showBackgroundRef.current = showBackground;
  const showTerrainRef = useRef(showTerrain);
  showTerrainRef.current = showTerrain;
  const terrainDensityRef = useRef(terrainDensity);
  terrainDensityRef.current = terrainDensity;

  const layersFolderInputs = {
    background: { visible: showBackground, onVisible: setShowBackground, density: backgroundDensity, onDensity: setBackgroundDensity, densityEnabled: false },
    terrain: { visible: showTerrain, onVisible: setShowTerrain, density: terrainDensity, onDensity: setTerrainDensity, densityEnabled: true },
    borders: { visible: showBorders, onVisible: setShowBorders, density: borderDensity, onDensity: setBorderDensity, densityEnabled: false },
    contour: { visible: showContour, onVisible: setShowContour, density: contourDensity, onDensity: setContourDensity, densityEnabled: false },
  };

  // ── Projection (construction-time — a projection swap tears down and
  //    rebuilds the whole widget; there is no `setProjection`/`transitionTo`
  //    yet, see mapsKit.tsx's doc). ─────────────────────────────────────────
  const [projectionId, setProjectionId] = useState<MapProjectionId>(initial.projection);
  const [exaggeration, setExaggeration] = useState(initial.exaggeration);

  // ── View — mirrors the widget's own `GlyphMapView` (center/span), plus the
  //    sheet-only camera tilt. Synced FROM the widget on drag/wheel via the
  //    "move"/"zoom" events, and pushed TO the widget imperatively when a
  //    slider changes it. ──────────────────────────────────────────────────
  const [centerLon, setCenterLon] = useState(initial.centerLon);
  const [centerLat, setCenterLat] = useState(initial.centerLat);
  const [span, setSpan] = useState(initial.span);
  const [tilt, setTilt] = useState(initial.tilt);
  const [lod, setLod] = useState(0);
  const [degPerCell, setDegPerCell] = useState(0);

  const [palette, setPalette] = useState<MapPaletteName>(initial.palette);

  const [renderMode, setRenderMode] = useState<MapRenderMode>(initial.renderMode);
  const [glyphPalette, setGlyphPalette] = useState<MapGlyphPalette>(initial.glyphPalette);
  const [charMode, setCharMode] = useState<MapCharMode>(initial.charMode);
  const [colorEncoding, setColorEncoding] = useState<MapColorEncoding>(initial.colorEncoding);
  const [useColors, setUseColors] = useState(initial.useColors);
  const [density, setDensity] = useState(initial.density);
  const [smoothShading, setSmoothShading] = useState(initial.smoothShading);
  const [creaseAngle, setCreaseAngle] = useState(initial.creaseAngle);
  // Not URL-persisted (page-local presentation knobs, same trim SynthWorkbench
  // applies to e.g. voiceMode) — real `createGlyphScene` options nonetheless,
  // all forwarded through `DockRendering` below.
  const [featureEdges, setFeatureEdges] = useState(30);
  const [wireframeJunctions, setWireframeJunctions] = useState(false);
  const [hiddenLines, setHiddenLines] = useState<"show" | "hide">("show");
  const [solidWeightRamp, setSolidWeightRamp] = useState(false);
  const [dragDensity, setDragDensity] = useState(1);
  const [atlasReason, setAtlasReason] = useState<string | null>("Nothing rendered yet.");

  const [lighting, setLighting] = useState<MapLighting>({
    lightAzimuth: initial.lightAzimuth,
    lightElevation: initial.lightElevation,
    lightIntensity: initial.lightIntensity,
    lightColor: initial.lightColor,
    ambientIntensity: initial.ambientIntensity,
    ambientColor: initial.ambientColor,
  });

  const [mobilePanel, setMobilePanel] = useState<"places" | "controls" | "code" | null>(null);

  // Refs so imperative callbacks (map event handlers, the resize/interaction
  // observers) always read the latest value without re-subscribing.
  const centerRef = useRef<[number, number]>([centerLon, centerLat]);
  centerRef.current = [centerLon, centerLat];
  const spanRef = useRef(span);
  spanRef.current = span;
  const densityRef = useRef(density);
  densityRef.current = density;
  const dragDensityRef = useRef(dragDensity);
  dragDensityRef.current = dragDensity;

  // ── Load the baked ETOPO1 tile provider once. ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    createGeoTilesProvider()
      .then((p) => { if (!cancelled) setProvider(p); })
      .catch((err: unknown) => { if (!cancelled) setProviderError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  // ── Load Places from the baked admin_0 vector tile (real feature bounds,
  //    not hand-typed boxes — mapsKit.tsx's `loadMapPlaces` doc). ─────────
  useEffect(() => {
    let cancelled = false;
    loadMapPlaces()
      .then((p) => { if (!cancelled) setPlaces(p); })
      .catch((err: unknown) => console.warn("glyphcss/maps: failed to load places", err));
    return () => { cancelled = true; };
  }, []);

  // ── Load the baked admin_0 border vector-tile provider once. ───────────
  useEffect(() => {
    let cancelled = false;
    createVectorTilesProvider()
      .then((p) => { if (!cancelled) setVectorProvider(p); })
      .catch((err: unknown) => console.warn("glyphcss/maps: failed to load vector tiles", err));
    return () => { cancelled = true; };
  }, []);

  function applyDensity(dragging: boolean): void {
    const host = hostRef.current;
    if (!host) return;
    const factor = densityRef.current * (dragging ? dragDensityRef.current : 1);
    host.style.fontSize = `${BASE_FONT_PX / Math.max(0.05, factor)}px`;
  }

  // ── Build (or rebuild) the widget whenever the provider arrives or the
  //    projection/exaggeration changes — both are construction-time-only. ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !provider) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    applyDensity(false);

    const view: GlyphMapView = { center: centerRef.current, span: spanRef.current, cols: 160, rows: 64 };
    const projection = buildMapProjection(projectionId, exaggeration, centerRef.current);
    const lightingScene = buildMapLighting(lighting);

    const map = createGlyphMap(host, {
      view,
      projection,
      autoSize: true,
      tilt,
      controls: { drag: true, wheel: true },
      layers: [
        ...(showBackgroundRef.current ? [{ type: "background" as const, id: BACKGROUND_LAYER_ID, color: "#05070c" }] : []),
        ...(showTerrainRef.current
          ? [{
              type: "raster" as const,
              id: TERRAIN_LAYER_ID,
              source: provider,
              classifier: GlyphMapClassifiers.etopo1V1,
              colors: MAP_PALETTES[palette],
              density: terrainDensityRef.current,
            }]
          : []),
        ...(vectorProvider && showBordersRef.current
          ? [{ type: "line" as const, id: BORDER_LAYER_ID, source: vectorProvider, color: "#e8c988" }]
          : []),
      ],
      scene: {
        mode: renderMode,
        glyphPalette,
        charMode,
        colorEncoding,
        useColors,
        smoothShading,
        creaseAngle,
        // `featureEdges` is deliberately NOT forwarded: it's a mesh-BUILD-time
        // wireframe threshold (`trianglesToFeatureEdges`, packages/core) for
        // re-deriving edges from raw triangle soup — not a `GlyphSceneOptions`
        // runtime field. `glyphMapPolygons` already emits well-defined quads,
        // so there is nothing for it to apply to; the DockRendering slider
        // stays wired (required prop) but is a documented no-op here, same
        // spirit as this codebase's other per-mode no-op controls.
        wireframeJunctions,
        hiddenLines,
        solidWeightRamp: solidWeightRamp ? getSolidWeightRamp() ?? undefined : undefined,
        interactiveDownscale: 2,
        ...lightingScene,
      },
    });
    mapRef.current = map;

    function syncViewState(): void {
      const v = map.getView();
      setCenterLon(v.center[0]);
      setCenterLat(v.center[1]);
      setSpan(v.span);
      const deg = v.span / v.cols;
      setDegPerCell(deg);
      if (provider) {
        const zooms = [...provider.zooms].sort((a, b) => a.z - b.z);
        let chosen = zooms[0]?.z ?? 0;
        for (const level of zooms) {
          chosen = level.z;
          if (level.tileLonSpan / level.tileCols <= deg) break;
        }
        setLod(chosen);
      }
    }
    syncViewState();
    map.on("move", syncViewState);
    map.on("zoom", syncViewState);
    setAttributions(map.getAttributions());

    // `interactiveDownscale`/drag-density workaround: the widget owns its own
    // pointer handlers internally and never calls `scene.setInteracting()`
    // (verified against packages/maps/src/widget.ts — a real slice-3 gap,
    // see this page's own report), so a page that wants either lever has to
    // drive it itself from the same gesture the widget already listens to.
    let interacting = false;
    const onDown = (): void => {
      interacting = true;
      map.scene.setInteracting(true);
      applyDensity(true);
    };
    const onUp = (): void => {
      if (!interacting) return;
      interacting = false;
      map.scene.setInteracting(false);
      applyDensity(false);
      map.scene.rerender();
    };
    host.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      map.off("move", syncViewState);
      map.off("zoom", syncViewState);
      map.destroy();
      mapRef.current = null;
    };
    // Deliberately narrow deps — everything else in `scene`/`layers` above is
    // read once at construction and kept in sync by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, vectorProvider, projectionId, exaggeration]);

  // ── Palette / visibility / density recolor-or-remount: no live setter for
  //    any of these on a mounted raster layer (`addLayer`/`removeLayer` are
  //    the only layer mutators, packages/maps/src/widget.ts), so this
  //    removes and re-adds the SAME layer id. `density` passes straight
  //    through to glyphcss's own per-mesh `density` (GlyphMapRasterLayer.
  //    density's doc) — the one layer type actually wired this slice.
  //    Hiding the terrain is the SAME remove/re-add path, not a special
  //    case (coordinator's "keep one mechanism" — `raster` is already an
  //    ordinary layer type). ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !provider) return;
    map.removeLayer(TERRAIN_LAYER_ID);
    if (showTerrain) {
      map.addLayer({
        type: "raster",
        id: TERRAIN_LAYER_ID,
        source: provider,
        classifier: GlyphMapClassifiers.etopo1V1,
        colors: MAP_PALETTES[palette],
        density: terrainDensity,
      });
    }
    map.scene.rerender();
    setAttributions(map.getAttributions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, showTerrain, terrainDensity]);

  // ── Background toggle -> addLayer/removeLayer, same mechanism. `density`
  //    is a documented permanent no-op for `background` (no glyph
  //    resolution to multiply — GlyphMapBackgroundLayer.density's doc), so
  //    it is accepted here for a uniform layer object but not read again. ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.removeLayer(BACKGROUND_LAYER_ID);
    if (showBackground) {
      // No `beforeId`: a `background` layer only sets the host's CSS
      // background-color (`applyBackground()`, widget.ts) — it never
      // participates in depth-tested rendering, so layer ORDER relative to
      // terrain has no visual effect and threading a `beforeId` here would
      // throw whenever terrain happens to be hidden (its id isn't mounted).
      map.addLayer({ type: "background", id: BACKGROUND_LAYER_ID, color: "#05070c", density: backgroundDensity });
    }
    map.scene.rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBackground, backgroundDensity]);

  // ── Borders toggle -> addLayer/removeLayer on the ALREADY-mounted map
  //    (no recreation — mirrors the palette-recolor pattern above). ───────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !vectorProvider) return;
    map.removeLayer(BORDER_LAYER_ID);
    if (showBorders) {
      map.addLayer({ type: "line", id: BORDER_LAYER_ID, source: vectorProvider, color: "#e8c988" });
    }
    map.scene.rerender();
    setAttributions(map.getAttributions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBorders, vectorProvider]);

  // ── Contour toggle -> build a field snapshot from the currently-loaded
  //    ETOPO1 LOD tile (mapsKit.tsx's `loadContourField` doc — a static
  //    snapshot, not live-refining on pan/zoom, matching the contour
  //    layer's own documented scope) and mount/unmount it. ────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !provider) return;
    let cancelled = false;
    map.removeLayer(CONTOUR_LAYER_ID);
    if (showContour) {
      loadContourField(provider, map.getView())
        .then((field) => {
          if (cancelled || !mapRef.current) return;
          mapRef.current.addLayer({ type: "contour", id: CONTOUR_LAYER_ID, source: field, levels: 6, color: "#7fe8c9" });
          mapRef.current.scene.rerender();
        })
        .catch((err: unknown) => console.warn("glyphcss/maps: failed to build contour field", err));
    } else {
      map.scene.rerender();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showContour, provider]);

  // ── Rendering options -> `scene.setOptions()`. ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.scene.setOptions({
      mode: renderMode,
      glyphPalette,
      charMode,
      colorEncoding,
      useColors,
      smoothShading,
      creaseAngle,
      // See the construction-time comment above — not a real scene option.
      wireframeJunctions,
      hiddenLines,
      solidWeightRamp: solidWeightRamp ? getSolidWeightRamp() ?? undefined : undefined,
    });
    map.scene.rerender();
  }, [renderMode, glyphPalette, charMode, colorEncoding, useColors, smoothShading, creaseAngle, featureEdges, wireframeJunctions, hiddenLines, solidWeightRamp]);

  // ── Lighting -> `scene.setOptions()`. ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.scene.setOptions(buildMapLighting(lighting));
    map.scene.rerender();
  }, [lighting]);

  // ── Density -> host font-size (autoSize reads it back on next fit). ────
  useEffect(() => {
    applyDensity(false);
    const map = mapRef.current;
    if (!map) return;
    map.scene.fit();
    map.scene.rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  // ── Tilt -> map.setTilt() (works for both sheet and orbit projections —
  //    see widget.ts's `GlyphMapHandle.setTilt` doc). ──────────────────────
  const onTilt = useCallback((value: number) => {
    setTilt(value);
    mapRef.current?.setTilt(value);
  }, []);

  // ── Center/span sliders -> imperative `map.setView()`. ─────────────────
  const onCenter = useCallback((lon: number, lat: number) => {
    setCenterLon(lon);
    setCenterLat(lat);
    mapRef.current?.setView({ center: [lon, lat] });
  }, []);
  const onSpanChange = useCallback((value: number) => {
    setSpan(value);
    mapRef.current?.setView({ span: value });
  }, []);

  const handlePlace = useCallback((bounds: { west: number; east: number; south: number; north: number }) => {
    mapRef.current?.fitBounds(bounds);
  }, []);

  // ── Atlas availability (mirrors SynthWorkbench's own MutationObserver). ─
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pre = map.scene.output;
    const recompute = (): void => {
      setAtlasReason(computeGlyphAtlasAvailability(pre, { useColors, charMode }).reason);
    };
    recompute();
    const observer = new MutationObserver(recompute);
    observer.observe(pre, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, projectionId, exaggeration]);

  // ── URL persistence. ────────────────────────────────────────────────────
  useEffect(() => {
    writeMapsUrlState({
      projection: projectionId,
      exaggeration,
      centerLon,
      centerLat,
      span,
      tilt,
      palette,
      renderMode,
      glyphPalette,
      charMode,
      colorEncoding,
      useColors,
      density,
      smoothShading,
      creaseAngle,
      lightAzimuth: lighting.lightAzimuth,
      lightElevation: lighting.lightElevation,
      lightIntensity: lighting.lightIntensity,
      lightColor: lighting.lightColor,
      ambientIntensity: lighting.ambientIntensity,
      ambientColor: lighting.ambientColor,
    });
  }, [projectionId, exaggeration, centerLon, centerLat, span, tilt, palette, renderMode, glyphPalette, charMode, colorEncoding, useColors, density, smoothShading, creaseAngle, lighting]);

  // ── Export bar ──────────────────────────────────────────────────────────
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const handleCopyAscii = useCallback(async () => {
    const pre = mapRef.current?.scene.output ?? null;
    const text = extractAsciiFromPre(pre);
    if (text === null) {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }, []);

  const [svgState, setSvgState] = useState<"idle" | "downloaded" | "error">("idle");
  const handleDownloadSvg = useCallback(() => {
    const pre = mapRef.current?.scene.output ?? null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ok = downloadGlyphSvg(pre, `glyphcss-map-${projectionId}-${stamp}.svg`);
    setSvgState(ok ? "downloaded" : "error");
    setTimeout(() => setSvgState("idle"), 1500);
  }, [projectionId]);

  // Code panel toggle — closed by default, opened from the export bar next
  // to Copy ASCII / Download SVG, mirroring SynthWorkbench's own "Export"
  // toggle (`codeOpen`, `toggleCodeOpen`) exactly: same action class, same
  // `aria-expanded`, same title wording. Maps had no toggle at all before —
  // `CodePanel` mounted always-open, which is the defect this replaces.
  const [codeOpen, setCodeOpen] = useState(false);
  const toggleCodeOpen = useCallback(() => setCodeOpen((open) => !open), []);

  const onRenderModeChange = useCallback((mode: GalleryRenderPresentation) => {
    if (mode === "semantic") return; // never offered — semanticAvailable is false
    setRenderMode(mode);
  }, []);

  // ── Code panel — reuses GalleryWorkbench's `CodePanel` shell via its
  //    `override` prop (mapsKit.tsx's `buildMapsSnippet` doc: no @glyphcss/
  //    react or /vue bindings exist for maps yet, so every tab shows the
  //    same real vanilla snippet). ────────────────────────────────────────
  const mapsSnippet = useMemo(
    () => buildMapsSnippet({
      projectionId, exaggeration, centerLon, centerLat, span, tilt, palette, renderMode,
      showBorders, showContour,
    }),
    [projectionId, exaggeration, centerLon, centerLat, span, tilt, palette, renderMode, showBorders, showContour],
  );
  const mapsSnippets = useMemo(
    () => ({ html: mapsSnippet, vanilla: mapsSnippet, react: mapsSnippet, vue: mapsSnippet }),
    [mapsSnippet],
  );

  return (
    <InstrumentShell kind="synth">
      <InstrumentBody>
        <InstrumentRail
          id="maps-places-panel"
          title="Layers & places"
          open={mobilePanel === "places"}
        >
          <LayersPanel {...layersFolderInputs} />
          <div className="maps-place-list">
            {places.map((place) => (
              <button key={place.label} type="button" className="maps-place" onClick={() => handlePlace(place.bounds)}>
                {place.label}
              </button>
            ))}
          </div>
        </InstrumentRail>
        <InstrumentMain elementRef={setStageHost}>
          <InstrumentViewport className="maps-viewport" elementRef={hostRef} />
          {providerError && <div className="maps-error">Couldn&apos;t load terrain data: {providerError}</div>}
          <StatsOverlay anchor="top-left" container={stageHost} />
          <div className="synth-export-bar">
            <button type="button" className="gw-code-panel__action" onClick={handleCopyAscii} title="Copy the rendered ASCII map to the clipboard">
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy ASCII"}
            </button>
            <button type="button" className="gw-code-panel__action" onClick={handleDownloadSvg} title="Download the rendered map as an SVG file">
              {svgState === "downloaded" ? "Downloaded" : svgState === "error" ? "Download failed" : "Download SVG"}
            </button>
            <button
              type="button"
              className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`}
              onClick={toggleCodeOpen}
              aria-expanded={codeOpen}
              title={codeOpen ? "Close export code window" : "Open export code window"}
            >
              Export
            </button>
          </div>
          {attributions.length > 0 && (
            <div className="maps-attribution">
              <AttributionCredit
                attributions={attributions.map((a) => ({ creator: a.name, license: a.license, sourceUrl: a.url, date: a.date }))}
              />
            </div>
          )}
          {(codeOpen || mobilePanel === "code") && (
            <CodePanel
              id="maps-code-panel"
              className={mobilePanel === "code" ? "is-mobile-open" : ""}
              override={{ snippets: mapsSnippets }}
            />
          )}
        </InstrumentMain>
        <Dock id="maps-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <MapsDockFolders
            projectionId={projectionId} exaggeration={exaggeration}
            onProjectionId={setProjectionId} onExaggeration={setExaggeration}
            centerLon={centerLon} centerLat={centerLat} span={span} tilt={tilt}
            lod={lod} degPerCell={degPerCell}
            onCenter={onCenter} onSpan={onSpanChange} onTilt={onTilt}
            palette={palette} onPalette={setPalette}
            renderMode={renderMode} glyphPalette={glyphPalette} charMode={charMode}
            wireframeJunctions={wireframeJunctions} hiddenLines={hiddenLines}
            solidWeightRamp={solidWeightRamp} colorEncoding={colorEncoding} atlasReason={atlasReason}
            density={density} dragDensity={dragDensity} useColors={useColors}
            smoothShading={smoothShading} creaseAngle={creaseAngle} featureEdges={featureEdges}
            onRenderModeChange={onRenderModeChange}
            onUpdateRendering={(partial) => {
              if (partial.glyphPalette !== undefined) setGlyphPalette(partial.glyphPalette as MapGlyphPalette);
              if (partial.charMode !== undefined) setCharMode(partial.charMode as MapCharMode);
              if (partial.wireframeJunctions !== undefined) setWireframeJunctions(partial.wireframeJunctions);
              if (partial.hiddenLines !== undefined) setHiddenLines(partial.hiddenLines);
              if (partial.solidWeightRamp !== undefined) setSolidWeightRamp(partial.solidWeightRamp);
              if (partial.colorEncoding !== undefined) setColorEncoding(partial.colorEncoding as MapColorEncoding);
              if (partial.density !== undefined) setDensity(partial.density);
              if (partial.dragDensity !== undefined) setDragDensity(partial.dragDensity);
              if (partial.useColors !== undefined) setUseColors(partial.useColors);
              if (partial.smoothShading !== undefined) setSmoothShading(partial.smoothShading);
              if (partial.creaseAngle !== undefined) setCreaseAngle(partial.creaseAngle);
              if (partial.featureEdges !== undefined) setFeatureEdges(partial.featureEdges);
            }}
            lighting={lighting}
            onUpdateLighting={(partial) => setLighting((l) => ({ ...l, ...partial }))}
          />
        </Dock>
      </InstrumentBody>
      <InstrumentMobileTabs label="Maps panels" items={[
        { id: "places", label: "Places", controls: "maps-places-panel", expanded: mobilePanel === "places", onClick: () => setMobilePanel((c) => c === "places" ? null : "places") },
        { id: "controls", label: "Controls", controls: "maps-controls-panel", expanded: mobilePanel === "controls", onClick: () => setMobilePanel((c) => c === "controls" ? null : "controls") },
        { id: "code", label: "Code", controls: "maps-code-panel", expanded: mobilePanel === "code", onClick: () => setMobilePanel((c) => c === "code" ? null : "code") },
      ]} />
    </InstrumentShell>
  );
}

// Small dock-content component (a Dock child, so `useDockGui()` resolves)
// bundling the map-specific folders + the reused DockLighting/DockRendering.
interface RenderingPartial {
  glyphPalette?: MapGlyphPalette;
  charMode?: MapCharMode;
  wireframeJunctions?: boolean;
  hiddenLines?: "show" | "hide";
  solidWeightRamp?: boolean;
  colorEncoding?: MapColorEncoding;
  density?: number;
  dragDensity?: number;
  useColors?: boolean;
  smoothShading?: boolean;
  creaseAngle?: number;
  featureEdges?: number;
}

function MapsDockFolders(props: {
  projectionId: MapProjectionId; exaggeration: number;
  onProjectionId: (id: MapProjectionId) => void; onExaggeration: (v: number) => void;
  centerLon: number; centerLat: number; span: number; tilt: number; lod: number; degPerCell: number;
  onCenter: (lon: number, lat: number) => void; onSpan: (v: number) => void; onTilt: (v: number) => void;
  palette: MapPaletteName; onPalette: (name: MapPaletteName) => void;
  renderMode: MapRenderMode; glyphPalette: MapGlyphPalette; charMode: MapCharMode;
  wireframeJunctions: boolean; hiddenLines: "show" | "hide"; solidWeightRamp: boolean;
  colorEncoding: MapColorEncoding; atlasReason: string | null;
  density: number; dragDensity: number; useColors: boolean; smoothShading: boolean; creaseAngle: number; featureEdges: number;
  onRenderModeChange: (mode: GalleryRenderPresentation) => void;
  onUpdateRendering: (partial: RenderingPartial) => void;
  lighting: MapLighting;
  onUpdateLighting: (partial: Partial<MapLighting>) => void;
}) {
  const gui = useDockGui();
  // Mercator's own valid domain is `±maxLat` (~85.05°), not a full 360°
  // span — reflected in the "Span" slider's max so it can't be dragged past
  // what the projection can actually show.
  const maxSpan = props.projectionId === "mercator" ? 170 : 360;

  useProjectionFolder(gui, {
    projectionId: props.projectionId, exaggeration: props.exaggeration,
    onProjectionId: props.onProjectionId, onExaggeration: props.onExaggeration,
  });
  useViewFolder(gui, {
    centerLon: props.centerLon, centerLat: props.centerLat, span: props.span, maxSpan, tilt: props.tilt,
    isOrbitProjection: props.projectionId === "globe", lod: props.lod, degPerCell: props.degPerCell,
    onCenter: props.onCenter, onSpan: props.onSpan, onTilt: props.onTilt,
  });
  useTerrainFolder(gui, { palette: props.palette, onPalette: props.onPalette });

  return (
    <>
      <DockRendering
        renderMode={props.renderMode}
        semanticAvailable={false}
        featureEdges={props.featureEdges}
        glyphPalette={props.glyphPalette}
        charMode={props.charMode}
        wireframeJunctions={props.wireframeJunctions}
        hiddenLines={props.hiddenLines}
        solidWeightRamp={props.solidWeightRamp}
        colorEncoding={props.colorEncoding}
        atlasReason={props.atlasReason}
        density={props.density}
        dragDensity={props.dragDensity}
        useColors={props.useColors}
        smoothShading={props.smoothShading}
        creaseAngle={props.creaseAngle}
        onRenderModeChange={props.onRenderModeChange}
        onUpdateScene={props.onUpdateRendering}
      />
      <DockLighting
        lightAzimuth={props.lighting.lightAzimuth}
        lightElevation={props.lighting.lightElevation}
        lightIntensity={props.lighting.lightIntensity}
        lightColor={props.lighting.lightColor}
        ambientIntensity={props.lighting.ambientIntensity}
        ambientColor={props.lighting.ambientColor}
        onUpdateScene={props.onUpdateLighting}
      />
    </>
  );
}
