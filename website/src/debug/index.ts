// Layout shell.
export { DebugLayout, useDebug, DEBUG_ROUTES } from "./DebugLayout";
export type { DebugRoute } from "./DebugLayout";
export { DebugSection } from "./DebugSection";
export { DebugStats } from "./DebugStats";
export { DebugScene } from "./DebugScene";

// Sidebar control primitives.
export { Row, Slider, Pills, Select, Checkbox } from "./controls";
export { ModelPicker } from "./ModelPicker";
export type { ModelPickerItem } from "./ModelPicker";

// Hooks.
export * from "./hooks";

// Mesh helpers.
export {
  decimateClustering,
  decimateEdgeLength,
  decimateQEM,
} from "./decimation";
export {
  PLATONIC_PALETTE,
  triangleToVoxel,
  polygonToVoxel,
  genTetrahedron,
  genCube,
  genOctahedron,
  genIcosahedron,
  genDodecahedron,
  genCuboctahedron,
  genCubePolygons,
  genDodecahedronPentagons,
  genCuboctahedronPolygons,
  SHAPE_GENERATORS,
  POLYGON_GENERATORS,
} from "./platonicShapes";
export type { Vec3, RawTriangle, RawPolygon, ShapeName } from "./platonicShapes";

// Reference renderer.
export { default as PolygonCanvas } from "./PolygonCanvas";
