import {
  createGlyphPerspectiveCamera,
  createGlyphScene,
  createGlyphOrbitControls,
  cubePolygons,
} from "glyphcss";

const host = document.getElementById("host")!;
const camera = createGlyphPerspectiveCamera({ rotX: 0.5, rotY: 0.4, zoom: 0.4, distance: 100 });
const scene = createGlyphScene(host, { camera });

createGlyphOrbitControls(scene, { drag: true, wheel: true });
scene.add(cubePolygons({ center: [0, 0, 0], size: 1, color: "#4488ff" }));

const handle = scene.addHotspot({ id: "corner", at: [1, 1, 1] }, () => alert("corner"));

// Style the hotspot overlay div once the scene has mounted.
const observer = new MutationObserver(() => {
  const el = host.querySelector(`[data-hotspot-id="corner"]`) as HTMLElement | null;
  if (!el) return;
  observer.disconnect();
  el.style.cssText =
    "cursor:pointer;background:#ff6644;color:#fff;padding:2px 6px;border-radius:4px;font-size:12px;white-space:nowrap;";
  el.textContent = "corner";
  el.addEventListener("click", () => alert("corner"));
});
observer.observe(host, { childList: true, subtree: true });

// Expose for devtools inspection.
(window as unknown as Record<string, unknown>).__hotspotHandle = handle;
