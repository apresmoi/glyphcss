import { useEffect, useRef } from "react";
import type { Polygon } from "@polycss/react";

type Vec3 = [number, number, number];

interface Props {
  voxels: Polygon[];
  zoom: number;
  width: number;
  height: number;
  /** Center-of-scene in world coords. Polygon coords are translated relative to this. */
  origin: Vec3;
  /**
   * Selector for the polycss scene element to read live rotation from.
   */
  voxSceneSelector?: string;
}

const TILE = 50;

export default function PolygonCanvas({ voxels, zoom, width, height, origin, voxSceneSelector = ".polycss-scene" }: Props) {
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

    // Build screen-space polygon list from the polygon data.
    const polys = voxels.map(p => ({
      v: p.vertices as Vec3[],
      color: p.color ?? "#3b82f6",
    }));

    let rafId = 0;
    let lastRotX = -1, lastRotY = -1;

    const project = (
      p: Vec3,
      cosX: number, sinX: number, cosY: number, sinY: number,
      cellSize: number, cx: number, cy: number,
    ): { sx: number; sy: number; depth: number } => {
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
        if (verts.length < 3) continue;
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
  }, [voxels, zoom, width, height, origin, voxSceneSelector]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}

function shade(baseHex: string, intensity: number): string {
  if (!baseHex.startsWith("#") || baseHex.length < 7) return baseHex;
  const c = parseInt(baseHex.slice(1, 7), 16);
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  const k = Math.max(0, Math.min(1, intensity));
  const r2 = Math.round(r * k).toString(16).padStart(2, "0");
  const g2 = Math.round(g * k).toString(16).padStart(2, "0");
  const b2 = Math.round(b * k).toString(16).padStart(2, "0");
  return `#${r2}${g2}${b2}`;
}
