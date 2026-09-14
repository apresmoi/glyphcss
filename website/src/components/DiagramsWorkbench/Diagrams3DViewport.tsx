import { useEffect, useRef } from "react";
import {
  createGlyphOrbitControls, createGlyphOrthographicCamera, createGlyphScene,
  type GlyphMeshHandle, type GlyphOrbitControlsMode, type GlyphSceneObjectHandle, type Vec3,
} from "glyphcss";
import {
  GLYPH_DIAGRAM_3D_AMBIENT_LIGHT, GLYPH_DIAGRAM_3D_LIGHT, glyphDiagramObject, renderGlyphDiagram3d, resolveCharset,
  type GlyphDiagram3dCharset, type GlyphDiagram3dColorMode, type GlyphDiagram3dLayoutKind,
} from "@glyphcss/diagrams/3d";
import { defaultGlyphEffectParams, getGlyphEffect } from "@glyphcss/effects";
import type { GlyphGraph, GlyphGraphDirection } from "@glyphcss/diagrams";
import type { GlyphDiagramsWorkbenchCamera3d } from "./diagramsWorkbenchState";
import { resolveDiagrams3dSceneOptions } from "./diagrams3dSceneOptions";
import { INSTRUMENT_3D_EFFECT_ALL_TARGET, INSTRUMENT_3D_EFFECT_NONE } from "../InstrumentWorkbench/Instrument3DEffectsFolder";

/**
 * The live, orbitable `/diagrams` 3D viewport (packet D3, PLAN-3d.md §11's
 * D3 row) — a real `createGlyphScene` mounting `glyphDiagramObject` via
 * `scene.addObject`, exactly the pattern `/maps` and `/synth` already use
 * for their own live scenes (no lookalike renderer). The INITIAL camera
 * comes from `renderGlyphDiagram3d`'s own auto-fit (AGENTS.md's D3
 * requirement: "reuse it, never tune a constant") — a probe render at a
 * fixed 96x32 target computes `{ object, camera }` once, and that exact
 * camera seeds the live orbit controls; `center` is a FRACTION and `zoom`
 * is CSS-px-per-world-unit, both invariant to the live scene's own
 * `cols`/`rows` (`render3d.ts`'s own `fitCamera` doc), so reusing a camera
 * fitted at one grid size is correct at any other.
 *
 * After mount, ORBIT CONTROLS own the camera — this component never
 * resets it on a re-render, only when `graph`/`layout`/`seed`/
 * `direction`/`nodesep`/`ranksep`/`controlsMode` genuinely change (a
 * different mesh needs a different fit). `initialCamera` (from
 * `state.camera3d`, when the reader already orbited this exact graph
 * before, e.g. a shared `?d=` link) is read ONCE inside the effect and is
 * deliberately NOT an effect dependency — it must not fight the live
 * orbit controls on every settle.
 *
 * **Fix round 1, P1-1 — `charset`/`color` reach the live scene.** The
 * initial `createGlyphScene` call AND every later charset/colour edit both
 * go through `resolveDiagrams3dSceneOptions` (this file's own sibling,
 * which forwards to `@glyphcss/diagrams/3d`'s exported `resolveCharset` —
 * the SAME table `renderGlyphDiagram3d`'s static frame uses), applied via
 * `scene.setOptions` so a charset/colour change never tears the mesh or
 * camera down. `chromeNote` (rendered by the parent, from the SAME pure
 * function) is what "show the downgrade note in the frame chrome, exactly
 * like 2D" means here — `web` has no `TargetPreview` chrome to carry it.
 *
 * **Fix round 2, P1-1 — the live OBJECT is built from the resolver's FULL
 * result, not just the scene's render options.** Round 1 only forwarded
 * `mode`/`charMode`/`useColors` to `scene.setOptions` — the mount effect's
 * own `renderGlyphDiagram3d` probe call never passed `charset` at all, so
 * the live mesh's overlay (box outlines, the braille wireframe degrade)
 * was always built from the DEFAULT charset's `tier`/`boxOutline`
 * regardless of what the reader picked, breaking Copy/live parity on
 * every charset but the default. The mount effect now passes
 * `charset: latest.current.charset` so the INITIAL object is correct, and
 * a dedicated `[charset]` effect REBUILDS the object via `glyphDiagramObject`
 * (the same `{ tier, boxOutline }` `resolveDiagrams3dSceneOptions` resolves)
 * and swaps it in via `objectHandle.update()` — which "replaces meshes/
 * overlays wholesale, keeping the handle's identity" (AGENTS.md's "Scene
 * objects"), so the CAMERA is untouched (only the object, not the scene, is
 * touched) exactly like a colour-only edit. Because `update()` disposes and
 * re-adds every member mesh (fresh `GlyphMeshHandle`s, fresh ids), any
 * currently-mounted effect layer's mesh-set target is stale the instant a
 * charset change lands — `scene.addEffectLayer`'s own `target` is immutable
 * after mount (AGENTS.md's "Per-object targeting"), so this effect disposes
 * and reapplies the effect layer AFTER the object swap, never merely
 * retargets an old one.
 *
 * **Fix round 1, P1-2 — per-node effect targeting.** `effectId`/`effectTarget`
 * mount, retarget, or dispose one `scene.addEffectLayer` layer against the
 * object's own stable `node:<id>` mesh names (D1's own contract). `time` is
 * driven by this component's own `requestAnimationFrame` loop, cancelled
 * whenever the effect is disposed (a genuine `effectId`/target change, a
 * view switch, or unmount) — effects are PREVIEW-ONLY (AGENTS.md), so
 * nothing here ever reaches Copy ASCII/ANSI or the static frame.
 *
 * **Fix round 2 (found while extending this for P1-1's own object rebuild)
 * — a genuine RETARGET always fully remounts, never `layer.setOptions({
 * target })`.** glyphcss's own mesh-set effect target is IMMUTABLE after
 * mount (verified against the real library, not assumed): `setOptions`
 * with a DIFFERENT mesh-id set throws "an effect layer's mesh target is
 * immutable after mount; remove and re-add the layer to retarget it" — so
 * round 1's own "retarget without remounting" branch actually crashed the
 * moment a reader picked a different node while an effect was mounted.
 * `applyEffect()` now disposes and remounts on ANY change to `effectId` OR
 * `effectTargetNodeId`. Likewise, a STALE target (a `?d=` link naming a
 * node id the current graph doesn't have) resolves to `null` ("mount
 * nothing"), never glyphcss's own empty-array spelling — `addEffectLayer`
 * REJECTS a literal `[]` outright ("must contain at least one
 * GlyphMeshHandle"), also verified against the real library.
 */
export interface Diagrams3DViewportProps {
  readonly graph: GlyphGraph;
  readonly layout: GlyphDiagram3dLayoutKind;
  readonly seed: number;
  readonly direction?: GlyphGraphDirection;
  readonly nodesep: number;
  readonly ranksep: number;
  readonly controlsMode: GlyphOrbitControlsMode;
  readonly charset: GlyphDiagram3dCharset;
  readonly color: GlyphDiagram3dColorMode;
  /** `Instrument3DEffectsFolder`'s own state shape — `"none"` mounts no layer. */
  readonly effectId: string;
  /** `INSTRUMENT_3D_EFFECT_ALL_TARGET` or a node id (`graph.nodes[].id`). */
  readonly effectTargetNodeId: string;
  readonly initialCamera: GlyphDiagramsWorkbenchCamera3d | undefined;
  readonly onCameraSettled: (camera: GlyphDiagramsWorkbenchCamera3d) => void;
  readonly onError: (message: string) => void;
  readonly onReady?: () => void;
}

const PROBE_WIDTH = 96, PROBE_HEIGHT = 32;

function centroidOf(bounds: { readonly min: Vec3; readonly max: Vec3 }): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
}

interface EffectLayerHandleLike {
  setParams(params: Record<string, unknown>): void;
  dispose(): void;
}

export function Diagrams3DViewport(props: Diagrams3DViewportProps) {
  const { graph, layout, seed, direction, nodesep, ranksep, controlsMode, charset, color, effectId, effectTargetNodeId } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Latest callbacks/initial camera, read inside the mount effect without
  // being part of its dependency array (see the component doc above).
  const latest = useRef(props);
  latest.current = props;

  const sceneRef = useRef<ReturnType<typeof createGlyphScene> | null>(null);
  const objectHandleRef = useRef<GlyphSceneObjectHandle | null>(null);
  const effectRef = useRef<{ id: string; targetNodeId: string; layer: EffectLayerHandleLike; raf: number; t: number; last: number } | null>(null);

  function disposeEffect(): void {
    if (!effectRef.current) return;
    cancelAnimationFrame(effectRef.current.raf);
    effectRef.current.layer.dispose();
    effectRef.current = null;
  }

  /**
   * `undefined` (scene-wide), a real `GlyphMeshHandle`, or `null` for a
   * STALE target (a `?d=` link naming a node id from a different graph, or
   * a graph edit that removed the node) — `null` rather than glyphcss's own
   * empty-array "matches no mesh" spelling: `scene.addEffectLayer`'s
   * `normalizeTarget` REJECTS a literal `[]` outright ("an effect target
   * mesh array must contain at least one GlyphMeshHandle" — verified
   * against the real library, not assumed; round 1's own "empty array
   * means matches no mesh" claim never actually reached `addEffectLayer`
   * with one). `applyEffect` reads `null` as "mount nothing" instead.
   */
  function resolveEffectTarget(targetNodeId: string): GlyphMeshHandle | undefined | null {
    if (targetNodeId === INSTRUMENT_3D_EFFECT_ALL_TARGET) return undefined; // scene-wide — glyphcss's own default target
    return objectHandleRef.current?.meshes.get(`node:${targetNodeId}`) ?? null;
  }

  /**
   * Mounts, retargets or disposes the one effect layer for the CURRENT
   * `effectId`/`effectTargetNodeId` — called once right after the object
   * mounts, and again on every later change to either (including the
   * charset-rebuild effect below, whose `objectHandle.update()` disposes
   * and re-adds every member mesh).
   *
   * ALWAYS fully disposes and remounts on any real change — never
   * `layer.setOptions({ target })` to "retarget in place": glyphcss's own
   * mesh-set effect target is immutable after mount (verified against the
   * real library — `setOptions` with a DIFFERENT mesh-id set throws "an
   * effect layer's mesh target is immutable after mount; remove and re-add
   * the layer to retarget it"), so a genuine node-to-node retarget can only
   * ever be a fresh mount, exactly like a genuinely different effect id.
   */
  function applyEffect(): void {
    const scene = sceneRef.current;
    const objectHandle = objectHandleRef.current;
    if (!scene || !objectHandle) return; // object not mounted yet — the post-mount call below re-runs this
    const wantId = latest.current.effectId;
    const wantTargetNodeId = latest.current.effectTargetNodeId;
    if (wantId === INSTRUMENT_3D_EFFECT_NONE) { disposeEffect(); return; }
    if (effectRef.current && effectRef.current.id === wantId && effectRef.current.targetNodeId === wantTargetNodeId) return; // already correct
    disposeEffect();
    const target = resolveEffectTarget(wantTargetNodeId);
    if (target === null) return; // a stale target matches no mesh — the layer stays unmounted, never a throw
    const definition = getGlyphEffect(wantId);
    if (!definition) return; // unknown id — no-op, never a throw for a Dock-driven value
    const layer = scene.addEffectLayer({
      effect: definition as never, params: defaultGlyphEffectParams(definition as never), target: target as never,
    }) as unknown as EffectLayerHandleLike;
    const state = { id: wantId, targetNodeId: wantTargetNodeId, layer, raf: 0, t: 0, last: performance.now() };
    const tick = (now: number): void => {
      state.raf = requestAnimationFrame(tick);
      const dt = Math.min((now - state.last) / 1000, 0.1);
      state.last = now;
      state.t += dt;
      layer.setParams({ time: state.t });
    };
    state.raf = requestAnimationFrame(tick);
    effectRef.current = state;
  }

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    let scene: ReturnType<typeof createGlyphScene> | null = null;
    let controls: ReturnType<typeof createGlyphOrbitControls> | null = null;

    void (async () => {
      let fit: Awaited<ReturnType<typeof renderGlyphDiagram3d>>;
      try {
        const initial = latest.current.initialCamera;
        // `charset` (fix round 2, P1-1) — read via `latest.current`, not the
        // effect's own dependency array: a LATER charset change is handled
        // by the dedicated `[charset]` object-rebuild effect below, which
        // swaps the object in place without remounting the scene/camera.
        // This call only needs to seed the INITIAL object with whatever
        // charset was selected at mount time.
        fit = await renderGlyphDiagram3d(graph, {
          layout, seed, ...(direction ? { direction } : {}), nodesep, ranksep,
          target: "web", width: PROBE_WIDTH, height: PROBE_HEIGHT, charset: latest.current.charset,
          ...(initial ? { camera: initial } : {}),
        });
      } catch (error) {
        if (!cancelled) latest.current.onError((error as Error).message);
        return;
      }
      if (cancelled || !hostRef.current) return;

      const camera = fit.camera.mat
        ? createGlyphOrthographicCamera({ mat: [...fit.camera.mat], useMat: true, zoom: fit.camera.zoom })
        : createGlyphOrthographicCamera({ rotX: fit.camera.rotX, rotY: fit.camera.rotY, zoom: fit.camera.zoom });
      camera.target = centroidOf(fit.object.bounds);

      const resolved = resolveDiagrams3dSceneOptions(latest.current.charset, latest.current.color);
      scene = createGlyphScene(hostRef.current, {
        autoSize: true, mode: resolved.mode, charMode: resolved.charMode, hiddenLines: resolved.hiddenLines, useColors: resolved.useColors,
        directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
        camera,
      });
      const objectHandle = scene.addObject(fit.object);
      // `pitchRange: null` (AGENTS.md numeric conventions) — the user's
      // "rotates in any direction" requirement for turntable mode too;
      // `controlsMode` picks turntable vs. trackball, both reachable from
      // the Dock.
      controls = createGlyphOrbitControls(scene, { pitchRange: null, mode: controlsMode });
      const reportCamera = () => {
        const cam = scene!.camera;
        latest.current.onCameraSettled(
          cam.useMat && cam.mat ? { zoom: cam.zoom, mat: [...cam.mat] } : { zoom: cam.zoom, rotX: cam.rotX, rotY: cam.rotY },
        );
      };
      controls.addEventListener("end", reportCamera);

      sceneRef.current = scene;
      objectHandleRef.current = objectHandle;
      applyEffect(); // picks up whatever effectId/target were already selected when this mesh finished mounting
      latest.current.onReady?.();
    })();

    return () => {
      cancelled = true;
      disposeEffect();
      sceneRef.current = null;
      objectHandleRef.current = null;
      controls?.destroy();
      scene?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the component doc: `initialCamera`/callbacks/charset/color/effect are read via `latest` or applied by their own effects below, deliberately not tracked here.
  }, [graph, layout, seed, direction, nodesep, ranksep, controlsMode]);

  // Charset/colour: `scene.setOptions` only — never remounts the mesh or resets the camera.
  useEffect(() => {
    sceneRef.current?.setOptions(resolveDiagrams3dSceneOptions(charset, color));
  }, [charset, color]);

  // Charset ALSO rebuilds the mounted OBJECT's own overlay (fix round 2,
  // P1-1) — `tier`/`boxOutline` are baked into `glyphDiagramObject`'s
  // geometry/overlay at build time, not a scene-level render option the
  // effect above's `scene.setOptions` can reach. `objectHandle.update()`
  // swaps meshes/overlays wholesale but keeps the handle's identity and
  // never touches the scene's camera (AGENTS.md's "Scene objects"), so a
  // charset edit still never resets the view. Skipped while the mount
  // effect's own initial build is still in flight (`objectHandleRef.current`
  // null) — that build already reads `charset` fresh via `latest.current`,
  // so there is nothing stale for this effect to correct yet.
  useEffect(() => {
    const objectHandle = objectHandleRef.current;
    if (!objectHandle) return;
    let cancelled = false;
    const { canvasTier, boxOutline } = resolveCharset(charset);
    void (async () => {
      let next;
      try {
        next = await glyphDiagramObject(graph, {
          layout, seed, ...(direction ? { direction } : {}), nodesep, ranksep,
          tier: canvasTier, boxOutline,
        });
      } catch (error) {
        if (!cancelled) latest.current.onError((error as Error).message);
        return;
      }
      if (cancelled || objectHandleRef.current !== objectHandle) return;
      objectHandle.update(next);
      // Every member mesh is disposed and re-added by `update()` (fresh
      // `GlyphMeshHandle`s, fresh ids) — a currently-mounted effect layer's
      // mesh-set TARGET is immutable after mount (AGENTS.md's "Per-object
      // targeting"), so retargeting the OLD layer at a new id would throw;
      // dispose and remount fresh against the NEW handles instead.
      disposeEffect();
      applyEffect();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to `charset` alone: `graph`/`layout`/`seed`/`direction`/`nodesep`/`ranksep` changes already trigger the mount effect's own remount (which reads the current `charset` fresh via `latest`), and `color` never affects the object's own build (verified by `diagrams3dSceneOptions.test.ts`'s "independent of colour" case).
  }, [charset]);

  // Effect id/target.
  useEffect(() => { applyEffect(); }, [effectId, effectTargetNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={hostRef} className="diagrams-3d-host" aria-label="3D diagram viewport" />;
}
