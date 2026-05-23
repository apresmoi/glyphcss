import { Box, Column, Row, Spacer, Text } from "../ascii-layout";
import type { Renderable } from "../ascii-layout";

// Pipeline diagram for the landing's "How It Works" section.
//
// Two stacked, titled panels with a connecting arrow between them.
//
//   ┌─ [ JS · runs once ] ───────────────────────────────────────┐
//   │   mesh.glb   ─▶  rasterize        ─▶  <pre> × N frames     │
//   │   hotspot    ─▶  projectHotspots  ─▶  @keyframes positions │
//   └────────────────────────────────────────────────────────────┘
//                                  │
//                                  ▼
//   ┌─ [ CSS · plays forever ] ──────────────────────────────────┐
//   │           steps(N) drives the frame strip                  │
//   │           @keyframes drives the hotspots                   │
//   └────────────────────────────────────────────────────────────┘
//
// Below ~60 cols the horizontal "thing ─▶ thing ─▶ thing" rows get squeezed
// and labels truncate; we fall back to a stacked layout where each step gets
// its own line.

const HORIZONTAL_MIN_COLS = 60;

export function howItWorksDiagram(): Renderable {
  return ({ cols }) => {
    const layout = cols < HORIZONTAL_MIN_COLS ? verticalLayout() : horizontalLayout();
    return layout({ cols });
  };
}

function connector(): Renderable {
  return Column(
    [
      Text("│", { wrap: "none", align: "center" }),
      Text("▼", { wrap: "none", align: "center" }),
    ],
    { gap: 0 },
  );
}

function horizontalLayout(): Renderable {
  const meshRow = Row(
    [
      Text("mesh.glb", { wrap: "none", align: "center" }),
      Text("rasterize", { wrap: "none", align: "center" }),
      Text("<pre> × N frames", { wrap: "none", align: "center" }),
    ],
    { divider: "─▶", gap: 2 },
  );
  const hotspotRow = Row(
    [
      Text("hotspot", { wrap: "none", align: "center" }),
      Text("projectHotspots", { wrap: "none", align: "center" }),
      Text("@keyframes positions", { wrap: "none", align: "center" }),
    ],
    { divider: "─▶", gap: 2 },
  );

  const jsPanel = Box(
    Column([Spacer(1), meshRow, Spacer(1), hotspotRow, Spacer(1)], { gap: 0 }),
    { border: "single", title: "JS · runs once" },
  );

  const cssPanel = Box(
    Column(
      [
        Spacer(1),
        Text("steps(N) drives the frame strip", { wrap: "none", align: "center" }),
        Text("@keyframes drives the hotspots", { wrap: "none", align: "center" }),
        Spacer(1),
      ],
      { gap: 0 },
    ),
    { border: "single", title: "CSS · plays forever" },
  );

  return Column([jsPanel, connector(), cssPanel], { gap: 0 });
}

function verticalLayout(): Renderable {
  const arrow = Text("↓", { wrap: "none", align: "center" });

  const meshChain = Column(
    [
      Text("mesh.glb", { wrap: "none", align: "center" }),
      arrow,
      Text("rasterize", { wrap: "none", align: "center" }),
      arrow,
      Text("<pre> × N frames", { wrap: "none", align: "center" }),
    ],
    { gap: 0 },
  );
  const hotspotChain = Column(
    [
      Text("hotspot", { wrap: "none", align: "center" }),
      arrow,
      Text("projectHotspots", { wrap: "none", align: "center" }),
      arrow,
      Text("@keyframes positions", { wrap: "none", align: "center" }),
    ],
    { gap: 0 },
  );

  const jsPanel = Box(
    Column([Spacer(1), meshChain, Spacer(1), hotspotChain, Spacer(1)], { gap: 0 }),
    { border: "single", title: "JS · once" },
  );

  const cssPanel = Box(
    Column(
      [
        Spacer(1),
        Text("steps(N) frame strip", { wrap: "none", align: "center" }),
        Text("@keyframes hotspots", { wrap: "none", align: "center" }),
        Spacer(1),
      ],
      { gap: 0 },
    ),
    { border: "single", title: "CSS · forever" },
  );

  return Column([jsPanel, connector(), cssPanel], { gap: 0 });
}
