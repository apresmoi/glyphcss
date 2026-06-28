// Walkable FPV (first-person eyeMode) demo of per-mesh detail + occlusion,
// through the LOCAL library source. Served at /bench/lod-fpv.html.
import {
  createGlyphScene,
  createGlyphPerspectiveCamera,
  createGlyphFirstPersonControls,
  resolveGeometry,
} from "../packages/glyphcss/src/index";
import type { Polygon, Vec3, GlyphGeometryName } from "../packages/glyphcss/src/index";

const host = document.getElementById("host") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;

const camera = createGlyphPerspectiveCamera({ rotX: 90, rotY: 270, zoom: 34, distance: 0 });
const scene = createGlyphScene(host, {
  camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default",
  directionalLight: { direction: [-0.4, -0.6, -0.5], intensity: 1.1 }, ambientLight: { intensity: 0.5 },
});
host.style.fontSize = "12px";

function unit(name: string, span: number, at: Vec3, color: string): Polygon[] {
  const polys = resolveGeometry(name as GlyphGeometryName, { size: 1 });
  let mn: Vec3 = [1e9,1e9,1e9], mx: Vec3 = [-1e9,-1e9,-1e9];
  for (const p of polys) for (const v of p.vertices) for (let i=0;i<3;i++){ if(v[i]<mn[i])mn[i]=v[i]; if(v[i]>mx[i])mx[i]=v[i]; }
  const c=[(mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2];
  const s=span/(Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])||1);
  return polys.map(p=>({...p, color, vertices:p.vertices.map(([x,y,z])=>[(x-c[0])*s+at[0],(y-c[1])*s+at[1],(z-c[2])*s+at[2]] as Vec3)}));
}

// World: Z up, walk on XY. A corridor of meshes ahead (+Y) at eye height.
// A coarse RED wall block far, a fine BLUE hero near (overlaps it from spawn),
// a coarse GREEN block to the side. Walk with WASD; look with the mouse.
const EYE = 1.7;
scene.add(unit("cube",         3.2, [ 0.2, 12, EYE], "#ff5a5a"));              // far, coarse, big
const hero = scene.add(unit("icosahedron", 2.2, [-0.2, 7, EYE], "#5aa9ff"), { density: 4 }); // near hero
scene.add(unit("dodecahedron", 2.0, [-3.4, 9, EYE], "#9dff3b"));              // side, coarse
scene.add(unit("octahedron",   1.8, [ 3.4, 8, EYE], "#ffd24a"));

const fpv = createGlyphFirstPersonControls(scene, { moveSpeed: 6, eyeHeight: EYE, groundZ: 0 });
camera.target = [0, 0, EYE]; // eye at origin, eye height
camera.rotX = 90; camera.rotY = 270; // look level, down +Y (the corridor)
scene.rerender();

document.getElementById("occ")!.addEventListener("change", (e) => {
  hero.setTransform({ density: 4, transparent: !(e.target as HTMLInputElement).checked });
});

function frame(): void {
  const detailPres = host.querySelectorAll("pre.glyph-output--detail").length;
  const t = camera.target;
  hud.innerHTML = `<b>FPV — per-mesh detail + occlusion</b>\nclick canvas → mouse-look\nWASD move · Space jump\n\neye    ${t.map(n=>n.toFixed(1)).join(", ")}\nyaw ${Math.round(camera.rotY)}  pitch ${Math.round(camera.rotX)}\ndetail pres ${detailPres}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(() => requestAnimationFrame(() => { scene.fit(); scene.rerender(); frame(); }));
(window as unknown as Record<string, unknown>).__glyph = { scene, camera, fpv };
