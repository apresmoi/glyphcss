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
    // Packet C4, item 2: `renderGlyphChart3d`'s own `camera` option now
    // accepts `{ mat, zoom, center }` (mirroring `renderGlyphDiagram3d`
    // exactly, `render.ts`'s own doc) — this thread `mat`/`useMat` straight
    // through under a trackball orbit, reproducing that exact pose.
    // `rotX`/`rotY` must NEVER accompany `mat` — `render.ts`'s own
    // validation rejects both together with `bad-camera` ("pass either mat
    // (trackball) or rotX/rotY (Euler), not both"), so the Euler fields
    // (the last TURNTABLE pose before a mode switch, `Charts3dCamera.mat`'s
    // own doc) are dropped entirely on this branch — they were never what a
    // trackball orientation renders from anyway.
    const cameraOption = cam.useMat && cam.mat
      ? { mat: [...cam.mat], useMat: true, zoom: cam.zoom }
      : { rotX: cam.rotX, rotY: cam.rotY, zoom: cam.zoom };
    const out = renderGlyphChart3d(mark, {
      target: input.target, charset: input.charset, color: input.color,
      width: input.width, height: input.height, env: input.env,
      ...(input.showTitle ? { title } : {}),
      camera: cameraOption,
      // Packet C4 (codex review addition) — `"auto"` omits `options.style`
      // entirely, letting `renderGlyphChart3d`'s own `resolveGlyphChart3dStyle`
      // apply (the SAME resolution `resolveCharts3dStyle` mirrors for the
      // live viewport), never a page-side re-derivation on this exit.
      ...(input.view.style !== "auto" ? { style: input.view.style } : {}),
    });
    return { ok: true, text: out.text, html: out.html, title, description };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
