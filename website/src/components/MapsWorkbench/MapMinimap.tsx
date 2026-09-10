/**
 * The map's plan-view INSET — the fourth of this page's map overlays, and the
 * answer to "where is it that we are when we are zoomed in or in walk mode".
 *
 * ## Where it lives
 *
 * Built to match the three that were already there — `MapSearchBox` (top
 * centre), `MapCompass` (top right) and `MapWalkButton` (bottom right):
 * `position: absolute` inside `InstrumentMain`, `pointer-events` covering only
 * its own box so every drag and wheel gesture on the rest of the surface is
 * untouched, and its own reason for appearing and disappearing rather than a
 * permanent piece of chrome. It takes the bottom LEFT, stacked directly above
 * `.synth-export-bar`, which is the only corner with room left.
 *
 * Like `MapCompass` it renders NOTHING when it has nothing to say
 * (`mapsMinimap.ts`'s {@link mapMinimapVisible}), and unlike the other three
 * that is not only presentation: the widget it owns is destroyed with it, so a
 * globe-scale reader pays nothing at all — no scene, no tile sweep, no motion
 * loop (the widget's rAF loop is dirty-driven, so even a mounted idle inset is
 * free, but a destroyed one is free AND holds no tiles).
 *
 * ## Why it is a real second map
 *
 * `/maps` is an ASCII renderer. An inset drawn as SVG paths or a canvas would
 * be a picture OF this page rather than a piece of it, so this is a second
 * `createGlyphMap` on a second host, mounting three of the same OpenStreetMap
 * rows the page's own card mounts, off the SAME source instance — which is
 * what makes a tile address the two maps share a request they share
 * (`mapsOsm.ts`'s `createOsmSource` guards in flight, per instance).
 *
 * The two things drawn ON TOP of it are CSS/SVG and deliberately so: the "you
 * are here" dot and the view cone are chrome about the reader, not features of
 * the world, and drawing them as glyph layers would cost a render every time
 * the reader turned their head. The cone therefore rotates for free — it does
 * not rotate at all, because the inset is heading-up and the cone points up.
 *
 * ## What it costs, and the rule that bounds it
 *
 * Every write to the inset (`setView`, `setBearing`) rerenders it
 * synchronously, so the pose is pushed through `mapMinimapPoseStep` — half a
 * cell of travel, one cell of rotation at the edge — rather than on every
 * `move` the main map emits. The props themselves already arrive at most once
 * per displayed frame: `MapsWorkbench`'s `syncViewState` is rAF-throttled, so
 * this component adds NO second loop and no second listener, only a gate on
 * what that one loop already publishes.
 */
import { useEffect, useRef } from "react";
import { createGlyphMap, type GlyphMapHandle, type GlyphMapVectorSource } from "@glyphcss/maps";
import { injectGlyphBaseStyles } from "glyphcss";
import { MAP_SCENE_GLYPH_PALETTE, MAP_SCENE_RENDER_MODE, buildMapProjection, type MapProjectionId } from "./mapsKit";
import {
  MAP_MINIMAP_COLS,
  MAP_MINIMAP_ROWS,
  MAP_MINIMAP_SPAN_DEG,
  mapMinimapAppliedPose,
  mapMinimapConePath,
  mapMinimapConeWidthFraction,
  mapMinimapLabel,
  mapMinimapLayers,
  mapMinimapPoseStep,
  type MapMinimapPose,
} from "./mapsMinimap";

export interface MapMinimapProps {
  /** `mapsMinimap.ts`' {@link mapMinimapVisible} — the page decides, so the rule stays pure and testable. */
  readonly visible: boolean;
  /** Whether the walker is live. Only changes what is drawn ON the inset (the cone) and what it calls itself. */
  readonly walking: boolean;
  /** The page's ONE OpenStreetMap source instance — shared, never a second `createOsmSource`. */
  readonly source: GlyphMapVectorSource;
  /** The main map's projection, so the inset and the map are pictures of the same world. */
  readonly projectionId: MapProjectionId;
  readonly centerLon: number;
  readonly centerLat: number;
  /** The main map's heading. While walking this IS the walker's heading, which is what makes the inset heading-up. */
  readonly bearing: number;
}

/** The wedge, in a viewBox whose unit circle is the walker's horizon. */
const CONE_PATH = mapMinimapConePath();
const CONE_WIDTH_PERCENT = `${(mapMinimapConeWidthFraction() * 100).toFixed(3)}%`;

export function MapMinimap({ visible, walking, source, projectionId, centerLon, centerLat, bearing }: MapMinimapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GlyphMapHandle | null>(null);
  /** The pose the inset was last actually WRITTEN at — not the main map's, which runs ahead of it between steps. */
  const poseRef = useRef<MapMinimapPose | null>(null);
  /**
   * The live pose, for the construction effect to read WITHOUT listing it as a
   * dependency: the inset is built at wherever the map is when it appears, and
   * a rebuild on every step would defeat the whole update rule.
   */
  const latestRef = useRef<MapMinimapPose>({ lon: centerLon, lat: centerLat, bearing });
  latestRef.current = { lon: centerLon, lat: centerLat, bearing };

  useEffect(() => {
    const host = hostRef.current;
    if (!visible || !host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const pose = latestRef.current;
    const map = createGlyphMap(host, {
      view: { center: [pose.lon, pose.lat], span: MAP_MINIMAP_SPAN_DEG, cols: MAP_MINIMAP_COLS, rows: MAP_MINIMAP_ROWS },
      // Exaggeration is deliberately `1` and not the page's: nothing mounted
      // here has a height (a `fill` sits on the datum), so the only thing the
      // page's value could do is rebuild this widget every time the reader
      // moved the terrain slider.
      projection: buildMapProjection(projectionId, 1),
      // Top-down. A plan has no pitch; on the globe `0` is head-on, and on a
      // sheet it has to be said, since the widget's own sheet default is 40.
      tilt: 0,
      bearing: pose.bearing,
      // Not a map you drive. Every gesture belongs to the map underneath, and
      // an inset that could be dragged out of sync with it would be a second
      // place to be lost in.
      controls: { drag: false, wheel: false, tilt: false },
      layers: [...mapMinimapLayers(source)],
      scene: { mode: MAP_SCENE_RENDER_MODE, glyphPalette: MAP_SCENE_GLYPH_PALETTE, useColors: true },
    });
    mapRef.current = map;
    poseRef.current = pose;
    return () => {
      map.destroy();
      mapRef.current = null;
      poseRef.current = null;
    };
    // `centerLon`/`centerLat`/`bearing` are READ here and deliberately not
    // listed — they are the pose the inset opens at, and every later change
    // goes through the update-rule effect below on the mounted widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, projectionId, source]);

  useEffect(() => {
    const map = mapRef.current;
    const prev = poseRef.current;
    if (!map || !prev) return;
    const next: MapMinimapPose = { lon: centerLon, lat: centerLat, bearing };
    const step = mapMinimapPoseStep(prev, next);
    if (!step.move && !step.turn) return;
    poseRef.current = mapMinimapAppliedPose(prev, next, step);
    // Heading first, then centre: both rerender synchronously, and a frame
    // that owes both should land on the final pose rather than paint an
    // intermediate one.
    if (step.turn) map.setBearing(next.bearing);
    if (step.move) map.setView({ center: [next.lon, next.lat] });
  }, [centerLon, centerLat, bearing]);

  if (!visible) return null;
  // A character grid cannot be read out, so the whole inset names itself once
  // — `role="img"` plus the label, the same way `MapCompass` speaks its
  // needle through the button's own `aria-label` rather than through the SVG.
  const label = mapMinimapLabel(walking);
  return (
    <div className="maps-minimap" role="img" aria-label={label} title={label}>
      <div className="maps-minimap__frame">
        <div className="maps-minimap__host" ref={hostRef} aria-hidden="true" />
        {/* The reader, and what the reader can see. Both are chrome about the
            viewer rather than features of the world, so both are drawn over
            the glyphs instead of into them — and both are therefore free of
            the render the inset would otherwise owe on every turn. */}
        {walking && (
          <svg
            className="maps-minimap__cone"
            style={{ width: CONE_WIDTH_PERCENT }}
            viewBox="-100 -100 200 200"
            aria-hidden="true"
            focusable="false"
          >
            <path d={CONE_PATH} />
          </svg>
        )}
        <span className="maps-minimap__here" aria-hidden="true" />
      </div>
    </div>
  );
}
