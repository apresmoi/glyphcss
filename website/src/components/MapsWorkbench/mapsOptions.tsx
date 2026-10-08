import { type GlyphMapLabelAnchor } from "@glyphcss/maps";
import type { ReactNode } from "react";
import {
  OSM_LABEL_ANCHOR_OPTIONS,
  PROJECTION_OPTIONS,
  type MapProjectionId,
  type MapSunMode,
} from "../../features/maps/model/config";
import { SUN_MODE_LABELS } from "../../features/maps/model/lighting";
import { ToggleIcon } from "../IconToggle";

/**
 * One icon per placement: the feature's POINT as a filled dot at the centre
 * of the frame, and the LABEL as a box whose named edge sits on it.
 *
 * Drawing both is the whole point, because the vocabulary is MapLibre's and
 * MapLibre's `left` puts the label's LEFT EDGE on the point — so the label
 * reads out to the RIGHT of it. A control that showed only a bar on the left
 * for "left" would be showing the opposite of what the option does. The icon
 * shows where the label actually goes; the `title` says the rule in words.
 */
const OSM_LABEL_ANCHOR_ICONS: Record<GlyphMapLabelAnchor, ReactNode> = (() => {
  // Half-extents of the label box: 4 across, 2 down, on the 16x16 frame every
  // `ToggleIcon` uses.
  const box = (x: number, y: number) => (
    <ToggleIcon strokeWidth={1.2}>
      <rect x={x - 4} y={y - 2} width="8" height="4" rx="0.8" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </ToggleIcon>
  );
  return {
    center: box(8, 8),
    left: box(12, 8),
    right: box(4, 8),
    top: box(8, 11),
    bottom: box(8, 5),
    // Present so the record is total over the type — the control offers the
    // five above (see `OSM_LABEL_ANCHOR_OPTIONS`), and a corner reaching it
    // would otherwise render an empty button.
    "top-left": box(12, 11),
    "top-right": box(4, 11),
    "bottom-left": box(12, 5),
    "bottom-right": box(4, 5),
  };
})();

const OSM_LABEL_ANCHOR_DESCRIPTIONS: Record<string, string> = {
  center: "the label sits ON the point, centred — what a labelled row has always drawn",
  left: "the label's LEFT edge sits on the point, so the name reads out to the right of it",
  right: "the label's RIGHT edge sits on the point, so the name reads back to the left of it",
  top: "the label's TOP edge sits on the point, so the name hangs below it",
  bottom: "the label's BOTTOM edge sits on the point, so the name sits above it",
};

export const OSM_LABEL_ANCHOR_TOGGLE = OSM_LABEL_ANCHOR_OPTIONS.map((value) => ({
  value,
  icon: OSM_LABEL_ANCHOR_ICONS[value],
  label: value,
  desc: OSM_LABEL_ANCHOR_DESCRIPTIONS[value],
}));

const SUN_MODE_DESCRIPTIONS: Record<MapSunMode, string> = {
  off: "everything lit: on a globe the key light follows the camera, so the whole visible face is lit with no terminator (relief still shades)",
  realtime: "the sun where it actually is right now; the terminator keeps advancing (15 deg of longitude per hour)",
  manual: "the sun at a day and UTC hour you pick, frozen there",
};

const SUN_MODE_ICONS: Record<MapSunMode, ReactNode> = {
  // Full disc + rays: everything lit.
  off: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.2V3M8 13V14.8M1.2 8H3M13 8H14.8M3.2 3.2L4.5 4.5M11.5 11.5L12.8 12.8M12.8 3.2L11.5 4.5M4.5 11.5L3.2 12.8" />
    </ToggleIcon>
  ),
  // Clock face: the sun tracks the wall clock.
  realtime: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.2V8L10.8 9.8" />
    </ToggleIcon>
  ),
  // Half-lit disc: a terminator you place yourself.
  manual: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 1.7A6.3 6.3 0 0 1 8 14.3Z" fill="currentColor" />
    </ToggleIcon>
  ),
};

export const SUN_MODE_TOGGLE = (["off", "realtime", "manual"] as const).map((value) => ({
  value,
  icon: SUN_MODE_ICONS[value],
  label: SUN_MODE_LABELS[value],
  desc: SUN_MODE_DESCRIPTIONS[value],
}));

export const SHADOW_TOGGLE = (
  [
    {
      value: "off",
      label: "Off",
      desc: "no shadow pass at all — the render is byte-identical to a map built without this control",
    },
    {
      value: "on",
      label: "Cast",
      desc: "buildings and models drop a shadow onto the terrain and fill under them, along the same light the shading uses",
    },
  ] as const
).map(({ value, label, desc }) => ({
  value,
  label,
  desc,
  icon:
    value === "off" ? (
      // An empty block: something standing there, throwing nothing.
      <ToggleIcon strokeWidth={1.3}>
        <path d="M4.5 4.5H9.5V9.5H4.5Z" />
      </ToggleIcon>
    ) : (
      // The same block with its shadow laid out to one side.
      <ToggleIcon strokeWidth={1.3}>
        <path d="M4.5 4.5H9.5V9.5H4.5Z" />
        <path d="M9.5 9.5H14V12H4.5V9.5Z" fill="currentColor" stroke="none" opacity="0.55" />
      </ToggleIcon>
    ),
}));

// ── "Projection" picker — segmented icon toggle portaled into a slot at the
//    TOP of the Dock, above every folder (View/Rendering/Lighting): a
//    projection is the map's fundamental shape, not a scene/camera tuning
//    knob, so it reads as the first thing in the Dock rather than buried in
//    a folder. Laid out INLINE — label on the left, buttons on the right —
//    exactly like `MapsSunControls`' own Sun toggle below, reusing the same
//    `useDockSlot(folder, { position: "top" })` + `.dock-subcell` portal
//    mechanism rather than a second way to inject markup into lil-gui.
//    Reuses `IconToggle`/`ToggleIcon` from `SynthWorkbench/synthKit.tsx`
//    verbatim — the same segmented-icon control /synth's field/wave rows and
//    LoadersDock's Subcell row already use (`LoadersDock.tsx`'s own
//    import-and-use is the established cross-page pattern this follows).
//    `Exaggeration` stays in the rail's Terrain card (mapsKit.tsx's
//    `LayersPanel` doc) — it's a per-raster-layer property (the projection's
//    own vertical-relief argument), not a scene-level concern either.

const PROJECTION_ICONS: Record<MapProjectionId, ReactNode> = {
  // Wide rectangle, one evenly-spaced equator + one meridian — the plain
  // lon/lat grid with no distortion.
  equirectangular: (
    <ToggleIcon>
      <rect x="1.5" y="4" width="13" height="8" />
      <path d="M1.5 8H14.5M8 4V12" />
    </ToggleIcon>
  ),
  // Taller rectangle; graticule lines WIDEN toward top/bottom — the
  // stretch signature that reads unmistakably as Mercator at 15px.
  mercator: (
    <ToggleIcon>
      <rect x="4" y="1.5" width="8" height="13" />
      <path d="M4 8H12M4 5.8H12M4 3.2H12M4 10.2H12M4 12.8H12M8 1.5V14.5" />
    </ToggleIcon>
  ),
  // Circle + a horizontal equator ellipse + a vertical meridian ellipse —
  // the textbook "globe" glyph, curved throughout.
  globe: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6.3" />
      <ellipse cx="8" cy="8" rx="6.3" ry="1.8" />
      <ellipse cx="8" cy="8" rx="2.2" ry="6.3" />
    </ToggleIcon>
  ),
};

const PROJECTION_DESCRIPTIONS: Record<MapProjectionId, string> = {
  equirectangular:
    "the plain lat/lon grid, stretched by no math at all — pick it when you want raw coordinates to read off directly, at the cost of shapes and area both distorting away from the equator",
  mercator:
    "keeps angles and local shapes true (a coastline still looks right up close) but inflates area toward the poles — pick it for bearing-style navigation, not for comparing how big two regions really are",
  globe:
    "the true sphere, with correct shape and area everywhere on it — pick it to see the planet as it actually is, navigated by orbiting the camera instead of panning a flat sheet",
};

/** Built from `PROJECTION_OPTIONS` so the toggle and the option set can't drift. */
export const PROJECTION_TOGGLE = Object.entries(PROJECTION_OPTIONS).map(([label, value]) => ({
  value,
  icon: PROJECTION_ICONS[value],
  label,
  desc: PROJECTION_DESCRIPTIONS[value],
}));
