import { useEffect, useRef } from "react";
import {
  createGlyphOrbitControls, createGlyphOrthographicCamera, createGlyphScene,
  type GlyphOrbitControlsMode, type Vec3,
} from "glyphcss";
import { GLYPH_DIAGRAM_3D_AMBIENT_LIGHT, GLYPH_DIAGRAM_3D_LIGHT, renderGlyphDiagram3d, type GlyphDiagram3dLayoutKind, type GlyphDiagram3dZBy } from "@glyphcss/diagrams/3d";
import type { GlyphGraph, GlyphGraphDirection } from "@glyphcss/diagrams";
import type { GlyphDiagramsWorkbenchCamera3d } from "./diagramsWorkbenchState";

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
  readonly initialCamera: GlyphDiagramsWorkbenchCamera3d | undefined;
  readonly onCameraSettled: (camera: GlyphDiagramsWorkbenchCamera3d) => void;
  readonly onError: (message: string) => void;
  readonly onReady?: () => void;
}

const PROBE_WIDTH = 96, PROBE_HEIGHT = 32;

function centroidOf(bounds: { readonly min: Vec3; readonly max: Vec3 }): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
}

export function Diagrams3DViewport(props: Diagrams3DViewportProps) {
  const { graph, layout, zBy, seed, direction, nodesep, ranksep, controlsMode } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Latest callbacks/initial camera, read inside the effect without being
  // part of its dependency array (see the component doc above).
  const latest = useRef(props);
  latest.current = props;

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

      scene = createGlyphScene(hostRef.current, {
        autoSize: true, mode: "solid", useColors: true,
        directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
        camera,
      });
      scene.addObject(fit.object);
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
      latest.current.onReady?.();
    })();

    return () => {
      cancelled = true;
      controls?.destroy();
      scene?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the component doc: `initialCamera`/callbacks are read via `latest`, deliberately not tracked here.
  }, [graph, layout, zBy, seed, direction, nodesep, ranksep, controlsMode]);

  return <div ref={hostRef} className="diagrams-3d-host" aria-label="3D diagram viewport" />;
}
