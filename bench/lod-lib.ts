// Per-mesh detail + occlusion demo (library API), through the LOCAL library
// source. Served at /bench/lod-lib.html. Camera via ?cam=ortho|persp.
import {
  createGlyphScene,
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
  createGlyphOrbitControls,
  resolveGeometry,
} from "../packages/glyphcss/src/index";
import type { Polygon, Vec3, GlyphGeometryName } from "../packages/glyphcss/src/index";

const host = document.getElementById("host") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

const useP = new URLSearchParams(location.search).get("cam") === "persp";
const camera = useP
  ? createGlyphPerspectiveCamera({ rotX: 18, rotY: 0, zoom: 13, distance: 60 })
  : createGlyphOrthographicCamera({ rotX: 18, rotY: 0, zoom: 13 });
if (useP) ($("cam") as HTMLSelectElement).value = "persp";
$("cam").addEventListener("change", () => {
  const u = new URL(location.href); u.searchParams.set("cam", ($("cam") as HTMLSelectElement).value === "persp" ? "persp" : "ortho"); location.href = u.toString();
});
const ssaa = Math.max(1, parseInt(new URLSearchParams(location.search).get("ssaa") ?? "1", 10) || 1);
const lod = Math.max(1, parseFloat(new URLSearchParams(location.search).get("lod") ?? "1") || 1);
const scene = createGlyphScene(host, {
  camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default", supersample: ssaa,
  interactiveDownscale: lod,
  directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1.1 }, ambientLight: { intensity: 0.5 },
});
host.style.fontSize = "13px";
createGlyphOrbitControls(scene, { drag: true, wheel: true });

function unit(name: string, span: number, offset: Vec3, color: string): Polygon[] {
  const polys = resolveGeometry(name as GlyphGeometryName, { size: 1 });
  let mn: Vec3 = [1e9,1e9,1e9], mx: Vec3 = [-1e9,-1e9,-1e9];
  for (const p of polys) for (const v of p.vertices) for (let i=0;i<3;i++){ if(v[i]<mn[i])mn[i]=v[i]; if(v[i]>mx[i])mx[i]=v[i]; }
  const c=[(mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2];
  const s=span/(Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])||1);
  return polys.map(p=>({...p, color, vertices:p.vertices.map(([x,y,z])=>[(x-c[0])*s+offset[0],(y-c[1])*s+offset[1],(z-c[2])*s+offset[2]] as Vec3)}));
}

// A coarse RED base cube and a fine BLUE hero icosahedron interpenetrate along Z.
// ?solo=1 renders only the hero (used for pixel-alignment checks).
const solo = new URLSearchParams(location.search).get("solo") === "1";
if (!solo) scene.add(unit("cube", 2.6, [0, 0, -0.9], "#ff5a5a"));
const hero = scene.add(unit("icosahedron", 2.4, [0, 0, 0.9], "#5aa9ff"), { fontSize: 4 });

let fps = 0;
function updateHud(): void {
  hud.innerHTML = `<b>per-mesh detail + occlusion</b>\nbase   1 cube (red, shared pre)\nhero   1 ico (blue, ${$("fs").value}px)\nhero   ${$("transparent").checked ? "transparent (x-ray)" : "opaque (occludes)"}\nfps    ${fps ? fps.toFixed(0) : "— (drag / spin)"}`;
}
function applyHero(): void {
  hero.setTransform({ fontSize: parseInt($("fs").value, 10), transparent: $("transparent").checked });
  updateHud();
}
$("fs").addEventListener("input", () => { document.getElementById("fs-v")!.textContent = $("fs").value; applyHero(); });
$("transparent").addEventListener("change", applyHero);
$("colors").addEventListener("change", () => { scene.setOptions({ useColors: $("colors").checked }); scene.rerender(); });

let spin = false, frames = 0, t0 = performance.now();
$("spin").addEventListener("change", () => { spin = $("spin").checked; frames = 0; t0 = performance.now(); if (spin) tick(); else { fps = 0; updateHud(); } });
function tick(): void {
  if (!spin) return;
  camera.rotY = (camera.rotY + 0.5) % 360;
  scene.rerender();
  frames++;
  const now = performance.now();
  if (now - t0 >= 500) { fps = frames * 1000 / (now - t0); frames = 0; t0 = now; updateHud(); }
  requestAnimationFrame(tick);
}
requestAnimationFrame(() => requestAnimationFrame(() => { scene.fit(); applyHero(); updateHud(); }));

(window as unknown as Record<string, unknown>).__glyph = { scene, camera, hero };
