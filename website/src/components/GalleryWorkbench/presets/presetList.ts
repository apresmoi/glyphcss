import type { PresetModel, PrimitivePreset } from "../types";
import {
  GOOGLE_POLY_AMBER_ATTRIBUTION,
  KANGAROOZ_STING_ATTRIBUTION,
  PROJECT_CHRONO_OFFROAD_ATTRIBUTION,
  QUATERNIUS_ULTIMATE_SPACESHIPS_ATTRIBUTION,
  ATOMIC_REALM_POST_APOCALYPTIC_ATTRIBUTION,
  GOOGLE_POLY_FLYING_SAUCER_ATTRIBUTION,
  UTAH_TEAPOT_ATTRIBUTION,
  KENNEY_MINIGOLF_ATTRIBUTION,
  PRIMITIVE_ATTRIBUTION,
} from "./attributions";
import { GLB_PRESET_FILES, POLY_PIZZA_PRESET_FILES, VOX_PRESET_FILES, OBJ_PRESET_FILES } from "./presetFiles";
import { glbPreset, objPreset, voxPreset } from "./presetBuilders";
import { resolveGeometry } from "@glyphcss/core";
import type { Polygon, Vec3 } from "@glyphcss/core";

/**
 * Rotate polygons +90° around the world X axis so their natural Y-up axis maps
 * to the screen-up direction. Glyphcss inherits asciss's Z-up screen convention
 * — at default camera rotation (rotX 65°, rotY 45°), world +Z appears at the
 * top of the viewport and world +Y appears to the right. The axially-symmetric
 * helpers (cone, cylinder, pyramid, prism, antiprism, bipyramid, trapezohedron)
 * all build along +Y, so without this transform the cone would lie on its
 * side. Maps `(x, y, z) → (x, -z, y)`.
 */
function uprightAlongZ(polygons: Polygon[]): Polygon[] {
  return polygons.map((poly) => ({
    ...poly,
    vertices: poly.vertices.map(([x, y, z]) => [x, -z, y] as Vec3),
  }));
}

const PRIMITIVE_DEFAULTS = {
  kind: "primitive" as const,
  category: "Primitives",
  galleryBucket: "Primitives" as const,
  attribution: PRIMITIVE_ATTRIBUTION,
  // rotX / rotY are in DEGREES — gallery state stores degrees and converts to
  // radians once before sending to the runtime camera. Matches the rest of the
  // preset list. The default (65°, 45°) is the classic isometric view.
  zoom: 0.1,
  rotX: 65,
  rotY: 45,
};

const PRIMITIVE_PRESETS: PrimitivePreset[] = [
  // Platonic solids
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-tetrahedron",
    label: "Tetrahedron",
    generatePolygons: () => resolveGeometry("tetrahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-cube",
    label: "Cube",
    generatePolygons: () => resolveGeometry("cube", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-octahedron",
    label: "Octahedron",
    generatePolygons: () => resolveGeometry("octahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-dodecahedron",
    label: "Dodecahedron",
    generatePolygons: () => resolveGeometry("dodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-icosahedron",
    label: "Icosahedron",
    generatePolygons: () => resolveGeometry("icosahedron", { size: 1 }),
  },
  // Round / parametric
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-sphere",
    label: "Sphere",
    generatePolygons: () => resolveGeometry("sphere", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-cylinder",
    label: "Cylinder",
    generatePolygons: () => uprightAlongZ(resolveGeometry("cylinder", { size: 1 })),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-cone",
    label: "Cone",
    generatePolygons: () => uprightAlongZ(resolveGeometry("cone", { size: 1 })),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-torus",
    label: "Torus",
    rotX: 75,
    generatePolygons: () => resolveGeometry("torus", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-pyramid",
    label: "Pyramid",
    generatePolygons: () => uprightAlongZ(resolveGeometry("pyramid", { size: 1 })),
  },
  // Kepler-Poinsot star polyhedra
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-small-stellated-dodecahedron",
    label: "Small Stellated Dodecahedron",
    generatePolygons: () => resolveGeometry("smallStellatedDodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-great-dodecahedron",
    label: "Great Dodecahedron",
    generatePolygons: () => resolveGeometry("greatDodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-great-stellated-dodecahedron",
    label: "Great Stellated Dodecahedron",
    generatePolygons: () => resolveGeometry("greatStellatedDodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-great-icosahedron",
    label: "Great Icosahedron",
    generatePolygons: () => resolveGeometry("greatIcosahedron", { size: 1 }),
  },
  // Archimedean solids
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-cuboctahedron",
    label: "Cuboctahedron",
    generatePolygons: () => resolveGeometry("cuboctahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-icosidodecahedron",
    label: "Icosidodecahedron",
    generatePolygons: () => resolveGeometry("icosidodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-truncated-tetrahedron",
    label: "Truncated Tetrahedron",
    generatePolygons: () => resolveGeometry("truncatedTetrahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-truncated-cube",
    label: "Truncated Cube",
    generatePolygons: () => resolveGeometry("truncatedCube", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-truncated-octahedron",
    label: "Truncated Octahedron",
    generatePolygons: () => resolveGeometry("truncatedOctahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-truncated-dodecahedron",
    label: "Truncated Dodecahedron",
    generatePolygons: () => resolveGeometry("truncatedDodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-truncated-icosahedron",
    label: "Truncated Icosahedron",
    generatePolygons: () => resolveGeometry("truncatedIcosahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-truncated-cuboctahedron",
    label: "Truncated Cuboctahedron",
    generatePolygons: () => resolveGeometry("truncatedCuboctahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-truncated-icosidodecahedron",
    label: "Truncated Icosidodecahedron",
    generatePolygons: () => resolveGeometry("truncatedIcosidodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-rhombicuboctahedron",
    label: "Rhombicuboctahedron",
    generatePolygons: () => resolveGeometry("rhombicuboctahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-rhombicosidodecahedron",
    label: "Rhombicosidodecahedron",
    generatePolygons: () => resolveGeometry("rhombicosidodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-snub-cube",
    label: "Snub Cube",
    generatePolygons: () => resolveGeometry("snubCube", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-snub-dodecahedron",
    label: "Snub Dodecahedron",
    generatePolygons: () => resolveGeometry("snubDodecahedron", { size: 1 }),
  },
  // Catalan solids
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-rhombic-dodecahedron",
    label: "Rhombic Dodecahedron",
    generatePolygons: () => resolveGeometry("rhombicDodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-rhombic-triacontahedron",
    label: "Rhombic Triacontahedron",
    generatePolygons: () => resolveGeometry("rhombicTriacontahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-triakis-tetrahedron",
    label: "Triakis Tetrahedron",
    generatePolygons: () => resolveGeometry("triakisTetrahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-triakis-octahedron",
    label: "Triakis Octahedron",
    generatePolygons: () => resolveGeometry("triakisOctahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-triakis-icosahedron",
    label: "Triakis Icosahedron",
    generatePolygons: () => resolveGeometry("triakisIcosahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-tetrakis-hexahedron",
    label: "Tetrakis Hexahedron",
    generatePolygons: () => resolveGeometry("tetrakisHexahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-pentakis-dodecahedron",
    label: "Pentakis Dodecahedron",
    generatePolygons: () => resolveGeometry("pentakisDodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-disdyakis-dodecahedron",
    label: "Disdyakis Dodecahedron",
    generatePolygons: () => resolveGeometry("disdyakisDodecahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-disdyakis-triacontahedron",
    label: "Disdyakis Triacontahedron",
    generatePolygons: () => resolveGeometry("disdyakisTriacontahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-deltoidal-icositetrahedron",
    label: "Deltoidal Icositetrahedron",
    generatePolygons: () => resolveGeometry("deltoidalIcositetrahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-deltoidal-hexecontahedron",
    label: "Deltoidal Hexecontahedron",
    generatePolygons: () => resolveGeometry("deltoidalHexecontahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-pentagonal-icositetrahedron",
    label: "Pentagonal Icositetrahedron",
    generatePolygons: () => resolveGeometry("pentagonalIcositetrahedron", { size: 1 }),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-pentagonal-hexecontahedron",
    label: "Pentagonal Hexecontahedron",
    generatePolygons: () => resolveGeometry("pentagonalHexecontahedron", { size: 1 }),
  },
  // Parametric families
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-prism",
    label: "Prism (Hexagonal)",
    generatePolygons: () => uprightAlongZ(resolveGeometry("prism", { size: 1 })),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-antiprism",
    label: "Antiprism (Hexagonal)",
    generatePolygons: () => uprightAlongZ(resolveGeometry("antiprism", { size: 1 })),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-bipyramid",
    label: "Bipyramid (Hexagonal)",
    generatePolygons: () => uprightAlongZ(resolveGeometry("bipyramid", { size: 1 })),
  },
  {
    ...PRIMITIVE_DEFAULTS,
    id: "primitive-trapezohedron",
    label: "Trapezohedron (Pentagonal)",
    generatePolygons: () => uprightAlongZ(resolveGeometry("trapezohedron", { size: 1 })),
  },
];

export const PRESETS: PresetModel[] = [
  ...PRIMITIVE_PRESETS,
  {
    id: "chicken",
    label: "Chicken",
    category: "Characters",
    kind: "obj",
    url: "/gallery/obj/chicken.obj",
    mtlUrl: "/gallery/obj/chicken.mtl",
    zoom: 0.15,
    rotX: 74.4,
    rotY: 301.6,
    attribution: GOOGLE_POLY_AMBER_ATTRIBUTION,
  },
  {
    id: "sting",
    label: "Sting Sword",
    category: "Weapons",
    kind: "obj",
    url: "/gallery/obj/sting.obj",
    galleryBucket: "Textured",
    zoom: 0.3,
    rotX: 65,
    rotY: 45,
    attribution: KANGAROOZ_STING_ATTRIBUTION,
  },
  {
    id: "cottage",
    label: "Cottage",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/cottage.obj",
    galleryBucket: "Textured",
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
    attribution: PROJECT_CHRONO_OFFROAD_ATTRIBUTION,
  },
  {
    id: "rock1",
    label: "Rock",
    category: "Environment",
    kind: "obj",
    url: "/gallery/obj/rock1.obj",
    mtlUrl: "/gallery/obj/rock1.mtl",
    galleryBucket: "Textured",
    zoom: 0.6,
    rotX: 65,
    rotY: 45,
    attribution: PROJECT_CHRONO_OFFROAD_ATTRIBUTION,
  },
  {
    id: "insurgent",
    label: "Ship - Insurgent",
    category: "Vehicles",
    kind: "gltf",
    url: "/gallery/glb/insurgent.gltf",
    galleryBucket: "Textured",
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
    attribution: { ...QUATERNIUS_ULTIMATE_SPACESHIPS_ATTRIBUTION, tris: 3012 },
  },
  {
    id: "apoc-car",
    label: "Apocalypse Car",
    category: "Vehicles",
    kind: "glb",
    url: "/gallery/glb/apocalypse/car.glb",
    galleryBucket: "Textured",
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
    attribution: ATOMIC_REALM_POST_APOCALYPTIC_ATTRIBUTION,
  },
  {
    id: "apoc-barrel",
    label: "Apocalypse Barrel",
    category: "Objects",
    kind: "glb",
    url: "/gallery/glb/apocalypse/barrel.glb",
    galleryBucket: "Textured",
    zoom: 0.5,
    rotX: 65,
    rotY: 45,
    attribution: ATOMIC_REALM_POST_APOCALYPTIC_ATTRIBUTION,
  },
  {
    id: "apoc-spike",
    label: "Spike Barricade",
    category: "Objects",
    kind: "glb",
    url: "/gallery/glb/apocalypse/wooden_spike_barricade.glb",
    galleryBucket: "Textured",
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
    attribution: ATOMIC_REALM_POST_APOCALYPTIC_ATTRIBUTION,
  },
  {
    id: "tree",
    label: "Tree",
    category: "Environment",
    kind: "glb",
    url: "/gallery/glb/tree.glb",
    zoom: 0.3,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "saucer",
    label: "Flying saucer",
    category: "Vehicles",
    kind: "glb",
    url: "/gallery/glb/poly-pizza/flying-saucer.glb",
    galleryBucket: "Textured",
    zoom: 0.2,
    rotX: 67,
    rotY: 42.3,
    attribution: GOOGLE_POLY_FLYING_SAUCER_ATTRIBUTION,
  },
  {
    id: "wheelbarrow",
    label: "Wheelbarrow",
    category: "Objects",
    kind: "obj",
    url: "/gallery/obj/wheelbarrow.obj",
    mtlUrl: "/gallery/obj/wheelbarrow.mtl",
    zoom: 0.2,
    rotX: 66.2,
    rotY: 36.1,
  },
  {
    id: "teapot",
    label: "Teapot",
    category: "Objects",
    kind: "obj",
    url: "/gallery/obj/teapot.obj",
    zoom: 0.2,
    rotX: 65,
    rotY: 45,
    attribution: UTAH_TEAPOT_ATTRIBUTION,
  },
  {
    id: "castle",
    label: "Castle",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/castle.obj",
    zoom: 0.15,
    rotX: 66.9,
    rotY: 68.5,
    attribution: KENNEY_MINIGOLF_ATTRIBUTION,
  },
  {
    id: "coliseum",
    label: "Coliseum",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/coliseum.obj",
    zoom: 0.15,
    rotX: 65,
    rotY: 45,
  },
  ...OBJ_PRESET_FILES.map(objPreset),
  ...GLB_PRESET_FILES.map(glbPreset),
  ...POLY_PIZZA_PRESET_FILES.map(glbPreset),
  ...VOX_PRESET_FILES.map(voxPreset),
];
