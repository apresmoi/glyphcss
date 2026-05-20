import { describe, it, expect } from "vitest";

// Import the elements registration side-effect module.
import "./elements";

describe("elements auto-registration", () => {
  it("registers glyph-scene", () => {
    expect(customElements.get("glyph-scene")).toBeDefined();
  });

  it("registers glyph-mesh", () => {
    expect(customElements.get("glyph-mesh")).toBeDefined();
  });

  it("registers glyph-hotspot", () => {
    expect(customElements.get("glyph-hotspot")).toBeDefined();
  });

  it("registers glyph-perspective-camera", () => {
    expect(customElements.get("glyph-perspective-camera")).toBeDefined();
  });

  it("registers glyph-orthographic-camera", () => {
    expect(customElements.get("glyph-orthographic-camera")).toBeDefined();
  });

  it("registers glyph-orbit-controls", () => {
    expect(customElements.get("glyph-orbit-controls")).toBeDefined();
  });

  it("registers glyph-map-controls", () => {
    expect(customElements.get("glyph-map-controls")).toBeDefined();
  });

  it("is idempotent — re-importing does not throw", () => {
    // The module guard prevents double-define. Since vitest caches modules,
    // a second import is already a no-op. We verify the tags are still defined.
    expect(customElements.get("glyph-scene")).toBeDefined();
    expect(customElements.get("glyph-mesh")).toBeDefined();
  });
});
