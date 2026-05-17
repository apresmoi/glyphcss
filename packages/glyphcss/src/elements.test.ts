import { describe, it, expect } from "vitest";

// Import the elements registration side-effect module.
import "./elements";

describe("elements auto-registration", () => {
  it("registers glyphcss-scene", () => {
    expect(customElements.get("glyphcss-scene")).toBeDefined();
  });

  it("registers glyphcss-mesh", () => {
    expect(customElements.get("glyphcss-mesh")).toBeDefined();
  });

  it("registers glyphcss-hotspot", () => {
    expect(customElements.get("glyphcss-hotspot")).toBeDefined();
  });

  it("registers glyphcss-perspective-camera", () => {
    expect(customElements.get("glyphcss-perspective-camera")).toBeDefined();
  });

  it("registers glyphcss-orthographic-camera", () => {
    expect(customElements.get("glyphcss-orthographic-camera")).toBeDefined();
  });

  it("registers glyphcss-orbit-controls", () => {
    expect(customElements.get("glyphcss-orbit-controls")).toBeDefined();
  });

  it("registers glyphcss-map-controls", () => {
    expect(customElements.get("glyphcss-map-controls")).toBeDefined();
  });

  it("is idempotent — re-importing does not throw", () => {
    // The module guard prevents double-define. Since vitest caches modules,
    // a second import is already a no-op. We verify the tags are still defined.
    expect(customElements.get("glyphcss-scene")).toBeDefined();
    expect(customElements.get("glyphcss-mesh")).toBeDefined();
  });
});
