import { Box, Column, Row, Rule, Spacer, Text } from "../ascii-layout";
import type { Renderable } from "../ascii-layout";

// The pipeline diagram: two parallel rows (mesh→rasterize→pre, hotspot→
// project→keyframes) inside a single box, with a footer noting where JS runs
// once vs where CSS plays forever.
//
// Each cell is its own Renderable so the Row primitive can allocate column
// widths from the viewport's measured `cols` — the arrows line up at any
// width down to ~50 columns.
// Threshold below which the 3-column horizontal layout truncates labels
// ("rasterize …", "projectHotspo…"). Below this we switch to a stacked
// vertical layout where each step gets its own line.
const HORIZONTAL_MIN_COLS = 60;

export function howItWorksDiagram(): Renderable {
  return ({ cols }) => {
    const layout = cols < HORIZONTAL_MIN_COLS ? verticalLayout() : horizontalLayout();
    return layout({ cols });
  };
}

function horizontalLayout(): Renderable {
  const mesh = Text("mesh.glb", { wrap: "none", align: "center" });
  const raster = Text("rasterize × N", { wrap: "none", align: "center" });
  const frames = Text("<pre> × N frames", { wrap: "none", align: "center" });
  const hotspot = Text("hotspot", { wrap: "none", align: "center" });
  const project = Text("projectHotspots × N", { wrap: "none", align: "center" });
  const keyframes = Text("@keyframes hit", { wrap: "none", align: "center" });

  const meshRow = Row([mesh, raster, frames], { divider: "─→", gap: 2 });
  const stepsNote = Text("▼ CSS steps(N)", { wrap: "none", align: "right" });
  const hotspotRow = Row([hotspot, project, keyframes], { divider: "─→", gap: 2 });

  const inner = Column(
    [Spacer(1), meshRow, stepsNote, hotspotRow, Spacer(1)],
    { gap: 0 },
  );
  const box = Box(inner, { border: "single" });
  const footer = Row(
    [
      Text("JS runs once ↑", { wrap: "none", align: "left" }),
      Text("↓ CSS plays forever", { wrap: "none", align: "right" }),
    ],
    { weights: [1, 1] },
  );
  return Column([box, footer], { gap: 0 });
}

function verticalLayout(): Renderable {
  const arrow = Text("↓", { wrap: "none", align: "center" });
  const meshChain = Column(
    [
      Text("mesh.glb", { wrap: "none", align: "center" }),
      arrow,
      Text("rasterize × N", { wrap: "none", align: "center" }),
      arrow,
      Text("<pre> × N frames", { wrap: "none", align: "center" }),
    ],
    { gap: 0 },
  );
  const hotspotChain = Column(
    [
      Text("hotspot", { wrap: "none", align: "center" }),
      arrow,
      Text("projectHotspots × N", { wrap: "none", align: "center" }),
      arrow,
      Text("@keyframes hit", { wrap: "none", align: "center" }),
    ],
    { gap: 0 },
  );
  const stepsNote = Text("▼ CSS steps(N)", { wrap: "none", align: "center" });

  const inner = Column(
    [Spacer(1), meshChain, Spacer(1), stepsNote, Spacer(1), hotspotChain, Spacer(1)],
    { gap: 0 },
  );
  const box = Box(inner, { border: "single" });
  const footer = Column(
    [
      Text("JS runs once ↑", { wrap: "none", align: "center" }),
      Text("↓ CSS plays forever", { wrap: "none", align: "center" }),
    ],
    { gap: 0 },
  );
  return Column([box, footer], { gap: 0 });
}
