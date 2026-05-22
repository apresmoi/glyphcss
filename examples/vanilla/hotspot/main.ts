import {
  createGlyphPerspectiveCamera,
  createGlyphScene,
  createGlyphOrbitControls,
  cubePolygons,
} from "glyphcss";

const host = document.getElementById("host")!;
const camera = createGlyphPerspectiveCamera({ rotX: 1.13, rotY: 0.785, zoom: 0.25, distance: 100 });
const scene = createGlyphScene(host, { camera, autoSize: true });

createGlyphOrbitControls(scene, { drag: true, wheel: true });
scene.add(cubePolygons({ center: [0, 0, 0], size: 1, color: "#4488ff" }));

// Cube edge length = 1 → corners at ±0.5. Anchor the hotspot at the +Z top corner.
const handle = scene.addHotspot({ id: "corner", at: [-0.5, -0.5, 0.5] }, () => alert("corner"));

// Style the hotspot overlay div once the scene has mounted.
// Use individual style assignments (not cssText) so the positioned left/top
// and transform set by updateHotspots() are never clobbered.
const observer = new MutationObserver(() => {
  const el = host.querySelector(`[data-hotspot-id="corner"]`) as HTMLElement | null;
  if (!el) return;
  observer.disconnect();
  el.style.background = "#ff6644";
  el.style.color = "#fff";
  el.style.padding = "2px 6px";
  el.style.borderRadius = "4px";
  el.style.fontSize = "12px";
  el.style.whiteSpace = "nowrap";
  el.textContent = "corner";
});
observer.observe(host, { childList: true, subtree: true });

// Expose for devtools inspection.
(window as unknown as Record<string, unknown>).__hotspotHandle = handle;
