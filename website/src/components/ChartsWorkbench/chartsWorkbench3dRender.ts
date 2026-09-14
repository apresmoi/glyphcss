// The 3D STATIC exit (packet C3, AGENTS.md's "Charts 3D" / "Export
// boundary"): terminal, chat, Copy ASCII/ANSI and the tray thumbnails all
// read `renderGlyphChart3d` at the resolved camera — never the live
// orbitable scene, which is web-only. One function so all four call sites
// agree on what "the current 3D chart" means.
import { renderGlyphChart3d } from "@glyphcss/charts/3d";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartTarget } from "@glyphcss/charts";
import { resolveCharts3dView, type Charts3dViewState } from "./chartsWorkbench3d";

export interface Charts3dRenderInput {
  readonly view: Charts3dViewState;
  readonly target: GlyphChartTarget;
  readonly charset: GlyphChartCharset;
  readonly color: GlyphChartColorMode;
  readonly width: number;
  readonly height: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Omit for the tray's small thumbnails, which show no title row. */
  readonly showTitle?: boolean;
}
export type Charts3dRenderResult =
  | { readonly ok: true; readonly text: string; readonly html?: string; readonly title: string; readonly description: string }
  | { readonly ok: false; readonly error: string };

export function renderCharts3dStatic(input: Charts3dRenderInput): Charts3dRenderResult {
  const resolved = resolveCharts3dView(input.view);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { mark, title, description } = resolved.resolved;
  try {
    const cam = input.view.camera;
    // KNOWN LIBRARY GAP (coordination note from the C2 fix round):
    // `renderGlyphChart3d`'s own `camera` option type is `{ rotX?, rotY?,
    // zoom? }` — it does not accept `{ mat }` yet, unlike
    // `renderGlyphDiagram3d`'s own camera option, which already does. Under
    // a TRACKBALL orbit (`cam.useMat`/`cam.mat` set — see
    // `Charts3dCamera.mat`'s own doc) this branch still THREADS `mat`/
    // `useMat` through rather than silently decomposing to `rotX`/`rotY`
    // (which would lose roll and render a WRONG pose) or hiding the
    // trackball case entirely — it is inert today (the library ignores the
    // extra fields and falls back to whatever stale `rotX`/`rotY` the mark
    // carries) and starts working the moment `GlyphChart3dCameraOptions`
    // gains `mat`. TODO(library): accept `{ mat, useMat }` in
    // `GlyphChart3dCameraOptions`, mirroring `renderGlyphDiagram3d`.
    const cameraOption = cam.useMat && cam.mat
      ? { rotX: cam.rotX, rotY: cam.rotY, zoom: cam.zoom, mat: [...cam.mat], useMat: true }
      : { rotX: cam.rotX, rotY: cam.rotY, zoom: cam.zoom };
    const out = renderGlyphChart3d(mark, {
      target: input.target, charset: input.charset, color: input.color,
      width: input.width, height: input.height, env: input.env,
      ...(input.showTitle ? { title } : {}),
      camera: cameraOption,
    });
    return { ok: true, text: out.text, html: out.html, title, description };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
