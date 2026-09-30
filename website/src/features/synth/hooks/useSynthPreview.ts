import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";
import { createGlyphOrthographicCamera, createGlyphScene, injectGlyphBaseStyles } from "glyphcss";
import { useEffect, useRef } from "react";
import { defaultGlyphColorEncoding } from "../../../services/rendering/glyphColorEncodingDefault";
import { flatQuad, frameObject, shapePolys, shapeTransform } from "../model/geometry";
import { type Params, AMBIENT, LIGHT, PREVIEW_STATIC_TIME, SYNTH_EFFECT_BLEND } from "../model/parameters";

// Small live preview. Head-on on a FLAT square by default (a plain 2D read of
// the field). `previewShape !== "plane"` (a voice/preset's `space ===
// "object"`) swaps that for a small tilted `shapePolys(previewShape)` mesh
// instead — a flat quad has zero depth, so entry and exit coincide
// everywhere and a volumetric/carve patch would preview as a degenerate
// point-sample rather than the 3D structure it actually renders (see
// AGENTS.md's "Note preset gallery previews" precedent). `previewShape`
// defaults to "cube" was the old hardcoded behavior; callers that care which
// volumetric mesh actually reads (the live stage shape, or a preset's own
// stage hint — VOLUMETRIC-2.md §3, "a pyramid-stage voice preview would
// lie") now pass it explicitly. `onTick` (if given) fires every frame
// alongside the layer's own time update, with the SAME `t` — so a waveform
// trendline drawn from it stays exactly in sync with what the adjacent
// preview square renders, using this loop instead of a second one. Defaults
// to "plane" (flat, non-volumetric) — the same default the old `volumetric =
// false` parameter had — so an omitted 5th argument still previews flat.
//
// `animate` (default `true`, preserving every existing call's behavior
// unchanged) gates the continuous rAF loop: with dozens of voice-card/preset
// previews mountable at once, each running its own `createGlyphScene` render
// loop wrecks page performance (glyphcss's own gallery of loaders + a full
// voice sidebar can easily reach 20+ concurrently mounted previews). Callers
// that want hover-to-animate (see `VoiceCard`'s `hoverToAnimate` prop and
// `PresetTile` below) drive this from local pointer-enter/leave state; a
// `false` value renders exactly ONE frame at `PREVIEW_STATIC_TIME` and stops
// the loop — no requestAnimationFrame runs until `animate` flips back to
// `true`, at which point the loop resumes counting up from that same fixed
// point (not from wherever a previous hover session left off), so a
// non-animating preview always looks identical, deterministic across
// mounts/hovers. `onTick` still fires once per static (re-)render, so a
// dependent trendline (VoiceCard's own waveform SVG) stays in sync with
// param edits made while NOT hovering, instead of going stale until the next
// hover starts.
export function useSynthPreview(
  host: HTMLElement | null,
  getParams: () => Params,
  deps: unknown[],
  onTick?: (t: number) => void,
  previewShape = "plane",
  animate = true,
): void {
  const layerRef = useRef<{ setParams: (p: Params) => void; dispose: () => void } | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const animateRef = useRef(animate);
  animateRef.current = animate;
  const volumetric = previewShape !== "plane";
  // Imperative start/stop/freeze for the CURRENT scene's rAF loop — a ref
  // (not state) because toggling it must not itself trigger a re-render or
  // recreate the scene. Set by the mount effect below; read by both the
  // deps-effect (static-mode re-renders on param change) and the
  // `animate`-effect (hover start/stop) that follow it.
  const loopRef = useRef<{ start: () => void; stop: () => void; renderStatic: () => void } | null>(null);

  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera(
      volumetric ? { rotX: 58, rotY: 32, zoom: 16 } : { rotX: 0, rotY: 0, zoom: 20 },
    );
    // Same site default the stage takes (`glyphColorEncodingDefault.ts`) — these
    // voice-card previews are their own `<pre>`s on /synth and /wordart, and
    // leaving them on spans would make the page half one encoding, half the
    // other. Deliberately NOT wired to the Dock's "Color encoding" toggle:
    // that control is a DOM-cost lever over the stage, and the two encodings
    // are visually identical, so a preview following it would buy nothing and
    // cost a scene remount per voice.
    const scene = createGlyphScene(host, {
      camera,
      autoSize: true,
      mode: "solid",
      useColors: true,
      glyphPalette: "default",
      doubleSided: !volumetric,
      directionalLight: LIGHT,
      ambientLight: AMBIENT,
      colorEncoding: defaultGlyphColorEncoding(),
    });
    host.style.fontSize = "6px";
    const polys = volumetric ? shapePolys(previewShape) : flatQuad(3);
    const meshTransform = volumetric ? shapeTransform(previewShape) : {};
    scene.add(polys, meshTransform);
    scene.fit();
    scene.rerender();
    frameObject(scene, camera, polys, volumetric ? 0.8 : 0.98, false, meshTransform);
    const layer = scene.addEffectLayer({
      effect: fieldSynth,
      params: getParams(),
      blend: SYNTH_EFFECT_BLEND,
      target: "surfaces",
    });
    layerRef.current = layer as unknown as { setParams: (p: Params) => void; dispose: () => void };
    scene.rerender();
    let last = performance.now(),
      t = PREVIEW_STATIC_TIME,
      raf = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t += dt * 0.8;
      layerRef.current?.setParams({ time: t });
      onTickRef.current?.(t);
    };
    const start = (): void => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const renderStatic = (): void => {
      stop(); // freezing means the loop must actually stop, not just repaint once
      t = PREVIEW_STATIC_TIME;
      layerRef.current?.setParams({ time: t });
      onTickRef.current?.(t);
    };
    loopRef.current = { start, stop, renderStatic };
    // Establishes the initial frame itself (rather than deferring entirely to
    // the `animate`-effect below) so a scene remount — a shape/stage change,
    // which re-runs THIS effect but not necessarily the `animate`-effect,
    // since `animate`'s own value may not have changed — still lands on the
    // right frame instead of the schema's own degenerate `t = 0` default.
    // The `animate`-effect fires too (same commit, same initial mount, or on
    // every later toggle) and may redundantly repeat this exact call; that's
    // a harmless one-time extra `onTick` at rest, never a second running loop.
    if (animateRef.current) start();
    else renderStatic();
    // `layerRef.current = null` here (not just `loopRef.current`) matters:
    // this cleanup and the deps-effect below run in DECLARATION order on the
    // SAME commit whenever `host` changes (React runs each effect's
    // cleanup-then-body before moving to the next). A caller whose own
    // `host` can go from a real element back to null while the component
    // STAYS MOUNTED — `ColorVoiceCard`'s "no preview" state for a
    // normal-derived field (VOLUMETRIC-4.md §1), toggled by conditionally
    // rendering the `ref={setHost}` span — hits exactly that: this cleanup
    // disposes `layer`, then the deps-effect's `layerRef.current?.setParams`
    // ran against the STALE (now-disposed) reference and threw "glyphcss:
    // effect layer is disposed" (found live via the Playwright smoke pass).
    // Every existing caller (`VoiceCard`, `PresetTile`) never re-triggers
    // this effect without also fully unmounting, so it never observed this.
    return () => {
      stop();
      loopRef.current = null;
      layerRef.current = null;
      layer.dispose();
      scene.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, volumetric, previewShape]);
  useEffect(() => {
    layerRef.current?.setParams(getParams());
    // Not animating: the rAF loop that would otherwise pick up these new
    // params on its next frame isn't running, so re-render the static frame
    // explicitly (and re-fire `onTick`, keeping a dependent trendline SVG in
    // sync with the edit) instead of going stale until the next hover.
    if (!animateRef.current) loopRef.current?.renderStatic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (animate) loopRef.current?.start();
    else loopRef.current?.renderStatic();
  }, [animate]);
}
