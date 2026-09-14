import { useEffect, useRef } from "react";
import {
  createGlyphOrbitControls, createGlyphOrthographicCamera, createGlyphScene,
  type GlyphOrbitControlsMode, type GlyphSceneObjectHandle, type Vec3,
} from "glyphcss";
import {
  GLYPH_DIAGRAM_3D_AMBIENT_LIGHT, GLYPH_DIAGRAM_3D_LIGHT, renderGlyphDiagram3d,
  type GlyphDiagram3dCharset, type GlyphDiagram3dColorMode, type GlyphDiagram3dLayoutKind, type GlyphDiagram3dZBy,
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
 * resets it on a re-render, only when `graph`/`layout`/`zBy`/`seed`/
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
 * **Fix round 1, P1-2 — per-node effect targeting.** `effectId`/`effectTarget`
 * mount, retarget, or dispose one `scene.addEffectLayer` layer against the
 * object's own stable `node:<id>` mesh names (D1's own contract). Retargeting
 * (same effect, different node) never remounts the layer — `setOptions({
 * target })`, the existing per-object-targeting mechanism. `time` is driven
 * by this component's own `requestAnimationFrame` loop, cancelled whenever
 * the effect is disposed (a genuine `effectId` change, a view switch, or
 * unmount) — effects are PREVIEW-ONLY (AGENTS.md), so nothing here ever
 * reaches Copy ASCII/ANSI or the static frame.
 */
export interface Diagrams3DViewportProps {
  readonly graph: GlyphGraph;
  readonly layout: GlyphDiagram3dLayoutKind;
  readonly zBy: GlyphDiagram3dZBy;
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
  setOptions(options: { target?: unknown }): void;
  dispose(): void;
}

export function Diagrams3DViewport(props: Diagrams3DViewportProps) {
  const { graph, layout, zBy, seed, direction, nodesep, ranksep, controlsMode, charset, color, effectId, effectTargetNodeId } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Latest callbacks/initial camera, read inside the mount effect without
  // being part of its dependency array (see the component doc above).
  const latest = useRef(props);
  latest.current = props;

  const sceneRef = useRef<ReturnType<typeof createGlyphScene> | null>(null);
  const objectHandleRef = useRef<GlyphSceneObjectHandle | null>(null);
  const effectRef = useRef<{ id: string; layer: EffectLayerHandleLike; raf: number; t: number; last: number } | null>(null);

  function disposeEffect(): void {
    if (!effectRef.current) return;
    cancelAnimationFrame(effectRef.current.raf);
    effectRef.current.layer.dispose();
    effectRef.current = null;
  }

  function resolveEffectTarget(targetNodeId: string) {
    if (targetNodeId === INSTRUMENT_3D_EFFECT_ALL_TARGET) return undefined; // scene-wide — glyphcss's own default target
    const mesh = objectHandleRef.current?.meshes.get(`node:${targetNodeId}`);
    // A STALE target (a `?d=` link naming a node id from a different graph,
    // or a graph edit that removed the node) must target NOTHING, never
    // fall back to scene-wide — an empty mesh array is glyphcss's own
    // "matches no mesh" spelling (AGENTS.md "Per-object targeting": the
    // layer is inactive outside solid mode, never a throw; the same idea
    // applies here for an id that resolves to no mesh at all).
    return mesh ? mesh : [];
  }

  /** Mounts, retargets or disposes the one effect layer for the CURRENT `effectId`/`effectTargetNodeId` — called once right after the object mounts, and again on every later change to either. */
  function applyEffect(): void {
    const scene = sceneRef.current;
    const objectHandle = objectHandleRef.current;
    if (!scene || !objectHandle) return; // object not mounted yet — the post-mount call below re-runs this
    const wantId = latest.current.effectId;
    const wantTarget = latest.current.effectTargetNodeId;
    if (wantId === INSTRUMENT_3D_EFFECT_NONE) { disposeEffect(); return; }
    if (effectRef.current && effectRef.current.id === wantId) {
      // Same effect, only the target moved — retarget without remounting
      // (AGENTS.md "Per-object targeting"), so `time`'s own animation keeps running.
      effectRef.current.layer.setOptions({ target: resolveEffectTarget(wantTarget) });
      return;
    }
    disposeEffect(); // a genuinely different effect needs its own mount
    const definition = getGlyphEffect(wantId);
    if (!definition) return; // unknown id — no-op, never a throw for a Dock-driven value
    const layer = scene.addEffectLayer({
      effect: definition as never, params: defaultGlyphEffectParams(definition as never), target: resolveEffectTarget(wantTarget),
    }) as unknown as EffectLayerHandleLike;
    const state = { id: wantId, layer, raf: 0, t: 0, last: performance.now() };
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
        fit = await renderGlyphDiagram3d(graph, {
          layout, zBy, seed, ...(direction ? { direction } : {}), nodesep, ranksep,
          target: "web", width: PROBE_WIDTH, height: PROBE_HEIGHT,
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
        autoSize: true, mode: resolved.mode, charMode: resolved.charMode, useColors: resolved.useColors,
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
  }, [graph, layout, zBy, seed, direction, nodesep, ranksep, controlsMode]);

  // Charset/colour: `scene.setOptions` only — never remounts the mesh or resets the camera.
  useEffect(() => {
    sceneRef.current?.setOptions(resolveDiagrams3dSceneOptions(charset, color));
  }, [charset, color]);

  // Effect id/target.
  useEffect(() => { applyEffect(); }, [effectId, effectTargetNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={hostRef} className="diagrams-3d-host" aria-label="3D diagram viewport" />;
}
