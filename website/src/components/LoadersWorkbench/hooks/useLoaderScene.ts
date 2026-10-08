import { getGlyphEffect } from "@glyphcss/effects";
import {
  createGlyphOrthographicCamera,
  createGlyphScene,
  type GlyphEffectDefinition,
  type GlyphEffectParamSchema,
  type GlyphSceneHandle,
  injectGlyphBaseStyles,
} from "glyphcss";
import { useEffect, useRef } from "react";
import { type LiveEdits } from "../../../features/loaders/model/liveEdits";
import { type LoaderLayer, type LoaderPreset } from "../../../features/loaders/model/loaders";
import {
  applyBrailleTracking,
  BRAILLE_BLANK_PALETTE,
  coverGrid,
  flatQuad,
  GHOST_BLANK_PALETTE,
  GHOST_CREST,
  GHOST_INK_LEVELS,
  GHOST_VALLEY,
  registerTick,
  rendersBraille,
} from "../../../features/loaders/render/loaderScene";
import { soloParams } from "../../../features/synth/model/geometry";
import { synthDefaults } from "../../../features/synth/model/parameters";
import { computeGlyphAtlasAvailability } from "../../../services/rendering/glyphAtlasAvailability";
import { defaultGlyphColorEncoding } from "../../../services/rendering/glyphColorEncodingDefault";

/** Mount one live loader at an exact cols×rows. Fixed grid (no `autoSize`) is
 *  the whole point — the box shape is the variable under test. */
export function useLoaderScene(
  host: HTMLElement | null,
  loader: LoaderPreset,
  cols: number,
  rows: number,
  live?: LiveEdits,
): void {
  const mountedRef = useRef<{ layer: ReturnType<GlyphSceneHandle["addEffectLayer"]>; spec: LoaderLayer }[]>([]);
  const sceneRef = useRef<GlyphSceneHandle | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  // Switching Subcell live changes which ramp the BASE must use, and the ramp is
  // fixed at scene creation — so this one edit re-mounts, unlike every other
  // param which is pushed into the running scene.
  const braille = rendersBraille(loader, live);

  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });
    const scene = createGlyphScene(host, {
      camera,
      cols,
      rows,
      autoSize: false,
      mode: "solid",
      useColors: true,
      glyphPalette: braille ? BRAILLE_BLANK_PALETTE : "default",
      // No `charMode` here on purpose: a mounted effect installs the scene's
      // `transformCells` hook (createGlyphScene.ts), and `wantsHalfblockSolid`/
      // `wantsQuadrantSolid` require that hook to be ABSENT — so halfblock and
      // quadrant are structurally unreachable for an effect-driven loader.
      // Sub-cell detail comes from field-synth's own `subcellRes: "2x4"`
      // (braille dots), which the Braille preset uses.
      doubleSided: true,
      directionalLight: { direction: [0.2, 0.3, 0.93], intensity: 0.85 },
      ambientLight: { intensity: 0.45 },
      // A catalog/footer thumbnail has no `live` edits object, so this used to
      // resolve to `undefined` -> glyphcss's own "spans". Fall through to the
      // site default instead, or the tiles would silently disagree with the
      // live size tiles the Dock control drives.
      colorEncoding: live?.colorEncoding.current ?? defaultGlyphColorEncoding(),
    });
    sceneRef.current = scene;
    const polys = flatQuad(3, "#243244");
    scene.add(polys);
    scene.rerender();
    // Before framing: tracking changes the cell width, and coverGrid measures
    // the real cell to derive cellAspect and the zoom.
    const pre = scene.host.querySelector("pre.glyph-output") as HTMLElement | null;
    if (pre && braille) {
      applyBrailleTracking(pre);
      // Tracking is calibrated for the Braille advance, so any cell the effect
      // does NOT cover — a wipe-masked progress bar's empty half, say — is an
      // ASCII space that measures narrower, and the box would grow as the fill
      // sweeps in. Pin the width to the ASCII grid (`ch` is the "0" advance, so
      // it tracks the Cell size slider) and coverage can no longer move it.
      // Masked-out runs are contiguous and blank, so the sub-pixel drift inside
      // them is invisible.
      pre.style.width = `${cols}ch`;
    }
    // Braille overscans a touch so no edge cell is left uncovered: an empty cell
    // is an ASCII space, and the negative tracking above is calibrated for the
    // Braille advance, so a stray space would measure narrow and pull the line
    // back out of alignment with the ASCII grid.
    coverGrid(scene, camera, polys, braille ? 1.2 : 1);
    scene.rerender();

    const mounted = loader.layers
      .map((spec, index) => {
        const definition = getGlyphEffect(spec.effectId);
        if (!definition) return null;
        const layer = scene.addEffectLayer({
          effect: definition as GlyphEffectDefinition<GlyphEffectParamSchema>,
          params: { ...spec.params, ...(liveRef.current?.layerParams[index] ?? {}) },
          // Braille needs EVERY cell to be a U+28xx glyph or the line mixes two
          // font advances (see BRAILLE_BLANK_PALETTE). Under `replace` a cell the
          // effect skips gets coverage 0 and the compositor forces a hard " ";
          // under `over` it falls through to the base's blank-Braille glyph, which
          // has no dots and so looks identical while measuring like Braille.
          blend: braille && spec.effectId === "field-synth" ? "over" : spec.blend,
          target: "surfaces",
        });
        return { layer, spec };
      })
      .filter(Boolean) as { layer: ReturnType<GlyphSceneHandle["addEffectLayer"]>; spec: LoaderLayer }[];
    mountedRef.current = mounted;

    scene.rerender();

    // Keeps the Dock's "Color encoding" disabled state current by watching
    // the stage `<pre>` directly (a `MutationObserver`, not a dependency
    // list) — same pattern /synth, /wordart, the gallery, and the vanilla
    // examples use. Only for LIVE tiles (the footer/catalog thumbnails stay
    // canonical, untouched, per `LiveEdits`'s own doc); every live size tile
    // shares one `colorEncoding` ref (they render the same patch at different
    // grid sizes) and reports through the same callback — last-writer-wins is
    // fine since they converge to the same value almost immediately.
    let atlasObserver: MutationObserver | null = null;
    if (live) {
      const recomputeAtlasAvailability = (): void => {
        const result = computeGlyphAtlasAvailability(scene.output, { useColors: true, charMode: "ascii" });
        live.onAtlasAvailability(result.reason);
      };
      recomputeAtlasAvailability();
      atlasObserver = new MutationObserver(recomputeAtlasAvailability);
      atlasObserver.observe(scene.output, { childList: true, subtree: true, characterData: true });
    }

    let clock = 0;
    let previous: number | null = null;
    const stop = registerTick((t) => {
      // A paused loader holds its frame: advance our own accumulator only while
      // running, so unpausing resumes instead of jumping forward by the gap.
      const drive = liveRef.current?.drive.current;
      if (previous !== null && !(drive?.paused ?? false)) clock += (t - previous) * (drive?.timeScale ?? 1);
      previous = t;
      for (const { layer, spec } of mounted) {
        const next: Record<string, number> = {};
        if (spec.timeScale) next.time = clock * spec.timeScale;
        // A determinate loader's sweep is just another driven param — the page
        // owns the clock, the effect owns the shape. Ramp over the first
        // `1 - hold` of the loop, then rest at 1.0: a bar that snaps straight
        // from full back to empty reads as a glitch, not as completion.
        if (spec.progress) {
          const { param, cycle, hold = 0 } = spec.progress;
          const phase = (clock % cycle) / cycle;
          const ramp = 1 - hold;
          next[param] = ramp <= 0 ? 1 : Math.min(1, phase / ramp);
        }
        if (Object.keys(next).length > 0) layer.setParams(next);
      }
    });
    return () => {
      stop();
      atlasObserver?.disconnect();
      mountedRef.current = [];
      sceneRef.current = null;
      for (const { layer } of mounted) layer.dispose();
      scene.destroy();
    };
  }, [host, cols, rows, loader, braille]);

  // Push edits without remounting — re-creating the scene per slider tick would
  // restart every animation mid-drag.
  const edits = live?.layerParams;
  useEffect(() => {
    if (!edits) return;
    mountedRef.current.forEach(({ layer }, index) => {
      const patch = edits[index];
      if (patch) layer.setParams(patch);
    });
  }, [edits]);

  // React to the "Color encoding" Dock toggle — pushed into the running
  // scene without remounting, same rationale as the effect-params push above.
  const colorEncoding = live?.colorEncoding.current;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !live) return;
    scene.setOptions({ colorEncoding });
    scene.rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorEncoding]);
}

/**
 * The hover overlay: its own scene writing its own `<pre>`, stacked over the
 * tile. Always mounted so a pointer move never pays a scene mount, but it only
 * renders while a voice is hovered — with no highlight it neither updates
 * params nor writes, and CSS hides it.
 */
export function useGhostScene(host: HTMLElement | null, cols: number, rows: number, live: LiveEdits): void {
  const liveRef = useRef(live);
  liveRef.current = live;
  const ghostSceneRef = useRef<GlyphSceneHandle | null>(null);

  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });
    const scene = createGlyphScene(host, {
      camera,
      cols,
      rows,
      autoSize: false,
      mode: "solid",
      useColors: true,
      glyphPalette: GHOST_BLANK_PALETTE,
      doubleSided: true,
      directionalLight: { direction: [0.2, 0.3, 0.93], intensity: 0.85 },
      ambientLight: { intensity: 0.45 },
      // The overlay is its own `<pre>` stacked over the tile, so it needs the
      // same encoding as the tile underneath or the page ends up half atlas,
      // half spans for no reason a reader could see.
      colorEncoding: liveRef.current.colorEncoding.current ?? defaultGlyphColorEncoding(),
    });
    const polys = flatQuad(3, "#000000");
    scene.add(polys);
    scene.rerender();
    coverGrid(scene, camera, polys);
    scene.rerender();

    const definition = getGlyphEffect("field-synth");
    const layer = definition
      ? scene.addEffectLayer({
          effect: definition as GlyphEffectDefinition<GlyphEffectParamSchema>,
          params: { ...synthDefaults(), subcellRes: "ink" },
          blend: "over",
          target: "surfaces",
        })
      : null;
    if (!layer) {
      scene.destroy();
      return;
    }

    let shownSlot: number | null = null;
    let clock = 0;
    let previous: number | null = null;
    const stop = registerTick((t) => {
      const drive = liveRef.current.drive.current;
      if (previous !== null && !drive.paused) clock += (t - previous) * drive.timeScale;
      previous = t;
      const { slot, params } = liveRef.current.highlight.current;
      if (slot !== shownSlot) {
        shownSlot = slot;
        host.style.opacity = slot === null ? "0" : "1";
        if (slot !== null) {
          layer.setParams({
            ...soloParams(params, slot),
            subcellRes: "ink",
            inkLevels: GHOST_INK_LEVELS,
            gain: 1,
            bias: 0.5,
            voiceColors: false,
            color: GHOST_CREST,
            colorB: GHOST_VALLEY,
            gradient: 1,
            lit: 0,
          });
        }
      }
      if (slot !== null) layer.setParams({ time: clock });
    });
    ghostSceneRef.current = scene;
    return () => {
      stop();
      layer.dispose();
      scene.destroy();
      ghostSceneRef.current = null;
    };
  }, [host, cols, rows]);

  // Mirror `useLoaderScene`'s own Dock push: toggling "Color encoding" has to
  // move the overlay too, and remounting it would restart its clock.
  const colorEncoding = live.colorEncoding.current;
  useEffect(() => {
    const scene = ghostSceneRef.current;
    if (!scene) return;
    scene.setOptions({ colorEncoding });
    scene.rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorEncoding]);
}
