import { useEffect, useRef } from "react";
import type { Voxel } from "@layoutit/voxcss/react";
import { voxelToPolygons, findGaps, findGeometricDefects } from "@layoutit/voxcss";
import type { Vec3 as CoreVec3 } from "@layoutit/voxcss";

type Vec3 = [number, number, number];

interface Props {
  voxels: Voxel[];
  zoom: number;
  width: number;
  height: number;
  /** Center-of-scene in voxel coords. Polygon coords are translated relative to this. */
  origin: Vec3;
  /**
   * When true, run the manifold check on the rendered polygons and overlay
   * any defective edges (open or non-manifold) in red. Sphere v3 should show
   * none; v1/v2 may show some, depending on the configuration.
   */
  showGaps?: boolean;
  /**
   * Selector for the voxcss scene element to read live rotation from. The
   * canvas re-reads the transform on every animation frame so dragging the
   * voxcss view stays perfectly in sync without React re-renders.
   */
  voxSceneSelector?: string;
}

const TILE = 50;

export default function PolygonCanvas({ voxels, zoom, width, height, origin, showGaps = false, voxSceneSelector = ".voxcss-scene" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Pre-build polygons once per voxel set, plus any gap segments to overlay.
    const polys = voxels.flatMap((v) => voxelToPolygons(v));
    const gaps = showGaps ? findGaps(polys) : [];
    // Geometric defects: exposed flat walls that face into a neighbor's
    // filled cell — visible kinks where shapes don't tile cleanly.
    const geometricDefects = showGaps ? findGeometricDefects(voxels) : [];

    let rafId = 0;
    let lastRotX = -1, lastRotY = -1;

    const project = (
      p: Vec3 | CoreVec3,
      cosX: number, sinX: number, cosY: number, sinY: number,
      cellSize: number, cx: number, cy: number,
    ): { sx: number; sy: number; depth: number } => {
      // Voxcss positions wrappers via `gridArea: "${voxel.x} / ${voxel.y}"` —
      // voxel.x = ROW (vertical/depth axis after tilt), voxel.y = COLUMN
      // (horizontal). Vertex projections must use that convention to match
      // voxcss's rendered orientation, especially for asymmetric shapes.
      const horiz = p[1] - origin[1];
      const depthAxis = p[0] - origin[0];
      const elev = p[2] - origin[2];
      const x1 = horiz * cosY - depthAxis * sinY;
      const y1 = horiz * sinY + depthAxis * cosY;
      const z1 = elev;
      const y2v = y1 * cosX - z1 * sinX;
      const z2v = y1 * sinX + z1 * cosX;
      return {
        sx: cx + x1 * cellSize,
        sy: cy + y2v * cellSize,
        depth: z2v,
      };
    };

    const render = (rotX: number, rotY: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, width, height);

      const cellSize = TILE * zoom;
      const cx = width / 2;
      const cy = height / 2;

      const rxRad = (rotX * Math.PI) / 180;
      const ryRad = (rotY * Math.PI) / 180;
      const cosX = Math.cos(rxRad), sinX = Math.sin(rxRad);
      const cosY = Math.cos(ryRad), sinY = Math.sin(ryRad);

      const projected = polys.map((p) => {
        const screen = p.v.map((vert) => project(vert, cosX, sinX, cosY, sinY, cellSize, cx, cy));
        let avg = 0;
        for (const s of screen) avg += s.depth;
        avg /= screen.length;
        return { p, screen, depth: avg };
      });

      // Back-face cull then back-to-front sort. Voxcss is left-handed (CSS y
      // is down), and our voxel.x↔voxel.y axis swap inverts handedness — so
      // a triangle that's CCW-from-outside in voxel space ends up rendering
      // as CW in canvas screen coords when its outward normal faces camera.
      // Keep cross<0 (those are the front faces) and cull the rest.
      const visible = projected.filter((item) => {
        const s = item.screen;
        if (s.length < 3) return true;
        const cross = (s[1].sx - s[0].sx) * (s[2].sy - s[0].sy)
                    - (s[1].sy - s[0].sy) * (s[2].sx - s[0].sx);
        return cross <= 0;
      });
      visible.sort((a, b) => a.depth - b.depth);

      const ld: Vec3 = [0.4, -0.4, -0.8];
      const ldLen = Math.hypot(ld[0], ld[1], ld[2]);
      ld[0] /= ldLen; ld[1] /= ldLen; ld[2] /= ldLen;

      for (const item of visible) {
        const verts = item.p.v;
        const a = verts[0], b = verts[1], c = verts[2];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const dot = nx * ld[0] + ny * ld[1] + nz * ld[2];
        const intensity = 0.45 + 0.55 * Math.max(0, Math.abs(dot));

        const baseColor = item.p.color ?? "#3b82f6";
        ctx.fillStyle = shade(baseColor, intensity);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(item.screen[0].sx, item.screen[0].sy);
        for (let i = 1; i < item.screen.length; i++) {
          ctx.lineTo(item.screen[i].sx, item.screen[i].sy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Overlay topological gap edges in bright red.
      if (gaps.length) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#ef4444";
        for (const g of gaps) {
          const a = project(g.segment[0], cosX, sinX, cosY, sinY, cellSize, cx, cy);
          const b = project(g.segment[1], cosX, sinX, cosY, sinY, cellSize, cx, cy);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }
      // Overlay geometric defects (inward-facing wall cells) as orange filled
      // quads with a thicker outline — distinct from topological gaps.
      if (geometricDefects.length) {
        for (const d of geometricDefects) {
          const verts = d.polygon.v.map((vert) =>
            project(vert, cosX, sinX, cosY, sinY, cellSize, cx, cy)
          );
          ctx.beginPath();
          ctx.moveTo(verts[0].sx, verts[0].sy);
          for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].sx, verts[i].sy);
          ctx.closePath();
          ctx.fillStyle = "rgba(249, 115, 22, 0.55)";
          ctx.fill();
          ctx.strokeStyle = "#fb923c";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      // Status badge.
      if (showGaps) {
        const total = gaps.length + geometricDefects.length;
        if (total === 0) {
          ctx.fillStyle = "rgba(34, 197, 94, 0.85)";
          ctx.fillRect(8, 8, 180, 22);
          ctx.fillStyle = "white";
          ctx.font = "12px monospace";
          ctx.fillText("✓ no gaps, no defects", 14, 23);
        } else {
          ctx.fillStyle = "rgba(239, 68, 68, 0.85)";
          ctx.fillRect(8, 8, 220, 38);
          ctx.fillStyle = "white";
          ctx.font = "12px monospace";
          ctx.fillText(`topological gaps: ${gaps.length}`, 14, 22);
          ctx.fillText(`geometric defects: ${geometricDefects.length}`, 14, 38);
        }
      }
    };

    const tick = () => {
      const sceneEl = document.querySelector(voxSceneSelector) as HTMLElement | null;
      let rotX = 65, rotY = 45;
      if (sceneEl) {
        const t = sceneEl.style.transform || "";
        const xMatch = t.match(/rotateX\(([-\d.]+)deg\)/);
        const yMatch = t.match(/rotate\(([-\d.]+)deg\)/);
        if (xMatch) rotX = parseFloat(xMatch[1]);
        if (yMatch) rotY = parseFloat(yMatch[1]);
      }
      if (rotX !== lastRotX || rotY !== lastRotY) {
        lastRotX = rotX;
        lastRotY = rotY;
        render(rotX, rotY);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [voxels, zoom, width, height, origin, showGaps, voxSceneSelector]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}

function shade(baseHex: string, intensity: number): string {
  const c = parseInt(baseHex.slice(1), 16);
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  const k = Math.max(0, Math.min(1, intensity));
  const r2 = Math.round(r * k).toString(16).padStart(2, "0");
  const g2 = Math.round(g * k).toString(16).padStart(2, "0");
  const b2 = Math.round(b * k).toString(16).padStart(2, "0");
  return `#${r2}${g2}${b2}`;
}
