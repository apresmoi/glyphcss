import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent } from "react";
import { GUI, type Controller } from "lil-gui";
import {
  PolyAxesHelper,
  PolyOrthographicCamera,
  PolyPerspectiveCamera,
  PolyMapControls,
  PolyOrbitControls,
  PolyDirectionalLightHelper,
  PolyMesh,
  PolyScene,
  PolySelect,
  PolyTransformControls,
  bakeSolidTextureSamples,
  parseGltf,
  parseMtl,
  parseObj,
  parsePureColor,
  optimizeMeshPolygons,
} from "@layoutit/polycss-react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  GltfParseOptions,
  MeshResolution,
  ObjParseOptions,
  ParseAnimationController,
  PolyMeshHandle as ReactPolyMeshHandle,
  Polygon,
  PolyRenderStrategy,
  PolyTextureLightingMode,
  Vec3 as ReactVec3,
} from "@layoutit/polycss-react";
import {
  axesHelperPolygons,
  createPolyOrbitControls,
  createPolyMapControls,
  createPolyScene,
  createSelect,
  createTransformControls,
  octahedronPolygons,
  parseVox,
} from "@layoutit/polycss";
import type {
  PolyControlsHandle,
  PolyMeshHandle as VanillaPolyMeshHandle,
  PolySceneOptions,
  PolySceneHandle,
  PolySelectionHandle,
  PolyTransformControlsHandle,
  TextureQuality,
  Vec3,
  VoxParseOptions,
} from "@layoutit/polycss";
import Stats from "stats-js/src/Stats.js";
import {
  InspectorPanel,
  type InspectorColorGroup,
  type InspectorMesh,
} from "./InspectorPanel";
import "./debug-workbench.css";

type Renderer = "react" | "vanilla";
type ModelKind = "obj" | "glb" | "gltf" | "vox";
type GalleryBucket = "Solid" | "Textured" | "Animated" | "Voxel";
type MatrixPrecision = "exact" | "2" | "3" | "4" | "5" | "6";
type BorderShapePrecision = "exact" | "2" | "3" | "4" | "5" | "6";
type DragMode = "orbit" | "pan";
type GizmoMode = "translate" | "rotate";
type PerspectiveMode = "perspective" | "orthographic";

const DOM_OVERPAINT_CACHE_EVENT = "polycss:dom-overpaint-cache";
const SPRITE_ALPHA_CACHE = new Map<string, number>();
const SPRITE_ALPHA_PENDING = new Set<string>();
const SPRITE_ALPHA_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();

interface PresetModel {
  id: string;
  label: string;
  kind: ModelKind;
  category: string;
  url: string;
  mtlUrl?: string;
  zoom?: number;
  rotX?: number;
  rotY?: number;
  options?: ObjParseOptions | GltfParseOptions | VoxParseOptions;
  galleryBucket?: GalleryBucket;
  attribution?: ModelAttribution;
}

interface DroppedModelSource {
  id: string;
  label: string;
  kind: Exclude<ModelKind, "gltf">;
  primaryFile: File;
  files: File[];
  preset: PresetModel;
}

interface ModelAttribution {
  creator: string;
  license?: string;
  sourceUrl?: string;
  tris?: number;
}

interface LoadedModel {
  label: string;
  kind: ModelKind;
  rawPolygons: Polygon[];
  polygons: Polygon[];
  sourcePolygons: number;
  sourceBytes: number;
  warnings: string[];
  parseMs: number;
  dispose: () => void;
  animation?: ParseAnimationController;
}

interface SceneOptionsState {
  renderer: Renderer;
  animationPaused: boolean;
  animationTimeScale: number;
  autoCenter: boolean;
  interactive: boolean;
  animate: boolean;
  showAxes: boolean;
  selection: boolean;
  hoverEffects: boolean;
  showLight: boolean;
  zoom: number;
  rotX: number;
  rotY: number;
  perspective: number | false;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  textureLighting: PolyTextureLightingMode;
  textureQuality: TextureQuality;
  experimentalTextureEdgeRepair: boolean;
  matrixPrecision: MatrixPrecision;
  borderShapePrecision: BorderShapePrecision;
  meshResolution: MeshResolution;
  meshInteriorFill: boolean;
  outlinePolygons: boolean;
  dragMode: "orbit" | "pan";
  target: ReactVec3;
  disableStrategies: PolyRenderStrategy[];
  castShadow: boolean;
  showGround: boolean;
}

interface ParserOptionsState {
  targetSize: number;
  gridShift: number;
  defaultColor: string;
}

interface DomMetrics {
  measuredAt: number;
  nodeCount: number;
  sprites: number;
  rects: number;
  triangles: number;
  irregular: number;
  overpaintPercent: number;
}

type GuiControllerMap = Record<string, any>;

function disableWithoutDisabledClass<T extends Controller>(controller: T): T {
  controller.disable();
  controller.domElement.classList.remove("disabled");
  return controller;
}

interface GalleryPresetFile {
  file: string;
  label?: string;
  category: string;
  targetSize?: number;
  zoom?: number;
  rotX?: number;
  rotY?: number;
  galleryBucket?: GalleryBucket;
  attribution?: ModelAttribution;
}

interface ObjGalleryPresetFile extends GalleryPresetFile {
  mtlFile?: string | null;
  defaultColor?: string;
  options?: ObjParseOptions;
}

function galleryFileUrl(folder: "glb" | "obj" | "vox", file: string): string {
  return `/gallery/${folder}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

function presetIdFromFile(prefix: string, file: string): string {
  return `${prefix}-${file
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()}`;
}

function labelFromFile(file: string): string {
  const base = file
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return base
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function glbPreset(input: GalleryPresetFile): PresetModel {
  return {
    id: presetIdFromFile("glb", input.file),
    label: input.label ?? labelFromFile(input.file),
    category: input.category,
    kind: "glb",
    url: galleryFileUrl("glb", input.file),
    options: { targetSize: input.targetSize ?? 60 },
    zoom: input.zoom ?? 0.4,
    rotX: input.rotX ?? 65,
    rotY: input.rotY ?? 45,
    galleryBucket: input.galleryBucket,
    attribution: input.attribution ?? GLB_PRESET_ATTRIBUTIONS[input.file],
  };
}

function objPreset(input: ObjGalleryPresetFile): PresetModel {
  const inferredMtlFile = input.file.replace(/\.obj$/i, ".mtl");
  const mtlFile = input.mtlFile === null ? undefined : input.mtlFile ?? inferredMtlFile;
  const hasMaterialTextures = Object.keys(input.options?.materialTextures ?? {}).length > 0;
  return {
    id: presetIdFromFile("obj", input.file),
    label: input.label ?? labelFromFile(input.file),
    category: input.category,
    kind: "obj",
    url: galleryFileUrl("obj", input.file),
    mtlUrl: mtlFile ? galleryFileUrl("obj", mtlFile) : undefined,
    options: {
      targetSize: input.targetSize ?? 60,
      defaultColor: input.defaultColor ?? "#8b95a1",
      ...(input.options ?? {}),
    },
    zoom: input.zoom ?? 0.35,
    rotX: input.rotX ?? 65,
    rotY: input.rotY ?? 45,
    galleryBucket: input.galleryBucket ?? (hasMaterialTextures ? "Textured" : undefined),
    attribution: input.attribution,
  };
}

function voxPreset(input: GalleryPresetFile): PresetModel {
  return {
    id: presetIdFromFile("vox", input.file),
    label: input.label ?? labelFromFile(input.file),
    category: input.category,
    kind: "vox",
    url: galleryFileUrl("vox", input.file),
    options: { targetSize: input.targetSize ?? 60, gridShift: 0 },
    zoom: input.zoom ?? 0.4,
    rotX: input.rotX ?? 65,
    rotY: input.rotY ?? 45,
    galleryBucket: input.galleryBucket,
    attribution: input.attribution,
  };
}

function stripParenthesizedText(label: string): string {
  return label.replace(/\s*\((?:GLB|UV-mapped|[^)]*\.(?:glb|gltf|obj|vox)[^)]*)\)/gi, "").trim();
}

const GALLERY_BUCKET_ORDER: GalleryBucket[] = ["Solid", "Textured", "Animated", "Voxel"];

const ANIMATED_PRESET_IDS = new Set([
  "glb-poly-pizza-cow",
  "glb-poly-pizza-llama",
  "glb-poly-pizza-man",
  "glb-poly-pizza-pug",
  "glb-poly-pizza-rabbit-blond",
  "glb-poly-pizza-sheep",
]);

function isAnimatedPreset(preset: Pick<PresetModel, "label" | "id" | "category" | "url">): boolean {
  return (
    ANIMATED_PRESET_IDS.has(preset.id) ||
    preset.category === "Animated" ||
    /animated/i.test(preset.label) ||
    /animated/i.test(preset.id)
  );
}

function galleryBucketForPreset(preset: PresetModel): GalleryBucket {
  if (isAnimatedPreset(preset)) return "Animated";
  if (preset.kind === "vox") return "Voxel";
  return preset.galleryBucket ?? "Solid";
}

function galleryBucketRank(category: string): number {
  const index = GALLERY_BUCKET_ORDER.indexOf(category as GalleryBucket);
  return index === -1 ? GALLERY_BUCKET_ORDER.length : index;
}

function AttributionCredit({ attribution }: { attribution?: ModelAttribution }) {
  if (!attribution) {
    return <p className="model-credit">Source: Unknown</p>;
  }

  const trisText =
    typeof attribution.tris === "number" ? ` · ${attribution.tris.toLocaleString()} tris` : "";

  return (
    <p className="model-credit">
      Source:{" "}
      {attribution.sourceUrl ? (
        <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">
          {attribution.creator}
        </a>
      ) : (
        attribution.creator
      )}
      {attribution.license ? ` · ${attribution.license}` : ""}
      {trisText}
    </p>
  );
}

const QUATERNIUS_ANIMATED_FISH_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://quaternius.itch.io/lowpoly-animated-fish",
};

const QUATERNIUS_ANIMATED_MONSTERS_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://quaternius.itch.io/lowpoly-animated-monsters",
};

const QUATERNIUS_EASY_ENEMIES_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://quaternius.itch.io/animated-easy-enemies",
};

const KHRONOS_FOX_ATTRIBUTION: ModelAttribution = {
  creator: "PixelMannen / tomkranis",
  license: "CC0 1.0 / CC-BY 4.0",
  sourceUrl: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox",
  tris: 576,
};

const QUATERNIUS_ULTIMATE_SPACESHIPS_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://quaternius.com/packs/ultimatespaceships.html",
};

const PROJECT_CHRONO_OFFROAD_ATTRIBUTION: ModelAttribution = {
  creator: "Project Chrono Development Team",
  license: "BSD-3-Clause",
  sourceUrl: "https://github.com/projectchrono/chrono/tree/main/data/sensor/offroad",
};

const WEBXR_CAVE_BAT_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "CC-BY 3.0",
  sourceUrl: "https://github.com/immersive-web/webxr-samples/blob/main/media/gltf/cave/ATTRIBUTION.md",
};

const KENNEY_MINIGOLF_ATTRIBUTION: ModelAttribution = {
  creator: "Kenney",
  license: "CC0 1.0",
  sourceUrl: "https://kenney.nl/assets/minigolf-kit",
};

const KANGAROOZ_STING_ATTRIBUTION: ModelAttribution = {
  creator: "KangaroOz 3D",
  license: "CC-BY 4.0",
  sourceUrl: "https://sketchfab.com/3d-models/sting-sword-lowpoly-c4f80dfbb61745d6807dd511d3e74fd4",
};

const GOOGLE_POLY_AMBER_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "CC-BY 2.0",
  sourceUrl: "https://github.com/blackspotbear/amber/blob/master/demo/README.md",
};

const GOOGLE_POLY_VIDEOLAB_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "CC-BY 3.0",
  sourceUrl: "https://github.com/keijiro/VideolabTest/blob/master/README.md",
};

const GOOGLE_POLY_FLYING_SAUCER_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "Creative Commons Attribution",
  sourceUrl: "https://poly.pizza/m/6hu2h8v78mO",
};

const POLY_PIZZA_DUCK_ATTRIBUTION: ModelAttribution = {
  creator: "jeremy",
  license: "CC-BY 3.0",
  sourceUrl: "https://poly.pizza/m/2KHEgw1ztVI",
};

const POLY_PIZZA_SAXOPHONE_ATTRIBUTION: ModelAttribution = {
  creator: "jeremy",
  license: "CC-BY 3.0",
  sourceUrl: "https://poly.pizza/m/6A2UAKdCNy7",
  tris: 812,
};

function polyPizzaJeremyAttribution(publicId: string): ModelAttribution {
  return {
    creator: "jeremy",
    license: "CC-BY 3.0",
    sourceUrl: `https://poly.pizza/m/${publicId}`,
  };
}

const MINI_MIKES_METRO_MINIS_ATTRIBUTION: ModelAttribution = {
  creator: "Mike Judge",
  license: "CC-BY 4.0",
  sourceUrl: "https://github.com/mikelovesrobots/mmmm",
};

const MONOGON_ANCIENT_ENVIRONMENT_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-ancient-environment",
};

const MONOGON_TINY_VOXEL_DUNGEON_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/tinyvoxeldungeon",
};

const MONOGON_DESERT_TOWN_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-desert-town",
};

const MONOGON_VOXEL_PLANE_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-plane",
};

const MONOGON_VOXEL_MECHAS_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-mechas",
};

const MONOGON_VOXEL_SPACESHIPS_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-spaceships",
};

const MONOGON_COUNTRY_SIDE_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/counrty-side",
};

const MONOGON_CYBERPUNK_CITY_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/cyberpunkcity-monogon",
};

const ATOMIC_REALM_POST_APOCALYPTIC_ATTRIBUTION: ModelAttribution = {
  creator: "Atomic Realm",
  license: "custom license, attribution required",
  sourceUrl: "https://atomicrealm.itch.io/post-apocalyptic-world",
};

const SONA_SAR_VOXEL_ANIMALS_ITEMS_ATTRIBUTION: ModelAttribution = {
  creator: "SonaSar",
  license: "personal/commercial use allowed",
  sourceUrl: "https://sona-sar.itch.io/voxel-animals-items-pack-free-assets",
};

const UTAH_TEAPOT_ATTRIBUTION: ModelAttribution = {
  creator: "Martin Newell / University of Utah",
  sourceUrl: "https://graphics.cs.utah.edu/teapot/",
};

function openGameArtAttribution(
  creator: string,
  slug: string,
  tris: number,
  license = "CC0 1.0",
): ModelAttribution {
  return {
    creator,
    license,
    sourceUrl: `https://opengameart.org/content/${slug}`,
    tris,
  };
}

function quaterniusAttribution(sourceUrl: string, tris: number): ModelAttribution {
  return {
    creator: "Quaternius",
    license: "CC0 1.0",
    sourceUrl,
    tris,
  };
}

const GLB_PRESET_ATTRIBUTIONS: Record<string, ModelAttribution> = {
  "FishAnimated.glb": QUATERNIUS_ANIMATED_FISH_ATTRIBUTION,
  "AnimatedMushnub.glb": QUATERNIUS_ANIMATED_MONSTERS_ATTRIBUTION,
  "AnimatedSnake.glb": QUATERNIUS_EASY_ENEMIES_ATTRIBUTION,
  "AnimatedWizard.glb": QUATERNIUS_ANIMATED_MONSTERS_ATTRIBUTION,
  "Bat.glb": WEBXR_CAVE_BAT_ATTRIBUTION,
  "Bear.glb": polyPizzaJeremyAttribution("evjB26aGfTh"),
  "Cheetah.glb": polyPizzaJeremyAttribution("ew0sr-amXFo"),
  "Dinosaur.glb": polyPizzaJeremyAttribution("5iV5SPhBu26"),
  "Dolphin.glb": GOOGLE_POLY_AMBER_ATTRIBUTION,
  "Dragon.glb": polyPizzaJeremyAttribution("3ZuMS3IRb0C"),
  "Duck.glb": POLY_PIZZA_DUCK_ATTRIBUTION,
  "Elephant.glb": polyPizzaJeremyAttribution("9J-cG39KYFC"),
  "Fly.glb": polyPizzaJeremyAttribution("f8kM9xA_5sV"),
  "Frog.glb": polyPizzaJeremyAttribution("07-wJ9bkzul"),
  "Gorilla.glb": polyPizzaJeremyAttribution("1aReOCuu0TY"),
  "Hippo.glb": polyPizzaJeremyAttribution("6fQJsxfOGUP"),
  "Koala.glb": GOOGLE_POLY_VIDEOLAB_ATTRIBUTION,
  "Lobster.glb": GOOGLE_POLY_AMBER_ATTRIBUTION,
  "Octopus.glb": polyPizzaJeremyAttribution("6KQsV8qo5E0"),
  "Owl.glb": polyPizzaJeremyAttribution("3IwTPvL_EAX"),
  "Pig.glb": polyPizzaJeremyAttribution("bbPhEBl5Bh0"),
  "Poodle.glb": polyPizzaJeremyAttribution("2ig2NlSneau"),
  "Rat.glb": GOOGLE_POLY_VIDEOLAB_ATTRIBUTION,
  "Robin.glb": polyPizzaJeremyAttribution("53HOg-b1F4r"),
  "Scorpion.glb": polyPizzaJeremyAttribution("cJfrRPiSgA4"),
  "Saxophone.glb": POLY_PIZZA_SAXOPHONE_ATTRIBUTION,
  "Snail.glb": polyPizzaJeremyAttribution("abd7jfOGZ94"),
  "Zebra.glb": polyPizzaJeremyAttribution("cKi5RxMBUxO"),
  "Bicycle.glb": polyPizzaJeremyAttribution("axc03j3xKfz"),
  "Dump truck.glb": polyPizzaJeremyAttribution("1BpGYg14QGD"),
  "Taxi.glb": polyPizzaJeremyAttribution("coQbjlCqWY9"),
  "Truck.glb": polyPizzaJeremyAttribution("cPVFA5uTr9l"),
  "Acousticguitar.glb": polyPizzaJeremyAttribution("afr6GCpce_I"),
  "Electricguitar.glb": polyPizzaJeremyAttribution("0hg94uOO-sS"),
  "Trumpet.glb": polyPizzaJeremyAttribution("0Mj5XgeGtKJ"),
  "Violin.glb": polyPizzaJeremyAttribution("fhj0GK-0kJu"),
  "apple.glb": polyPizzaJeremyAttribution("4tOmpD9-xsV"),
  "Grapes.glb": polyPizzaJeremyAttribution("csU4Smr2_aV"),
  "Hot dog.glb": polyPizzaJeremyAttribution("eiPR4iwcYpa"),
  "Watermelon.glb": polyPizzaJeremyAttribution("5NXaNnNIzfC"),
  "Campfire.glb": polyPizzaJeremyAttribution("dxxHpVXHLZg"),
  "Drill.glb": polyPizzaJeremyAttribution("93nEcwogYE0"),
  "Globe.glb": polyPizzaJeremyAttribution("2445qv4neDQ"),
};

const GLB_PRESET_FILES: GalleryPresetFile[] = [
  { file: "FishAnimated.glb", label: "Animated Fish", category: "Animated" },
  {
    file: "khronos/animated-fox.glb",
    label: "Animated Fox",
    category: "Animated",
    attribution: KHRONOS_FOX_ATTRIBUTION,
  },
  {
    file: "opengameart/animated-pliers.glb",
    label: "Animated Pliers",
    category: "Animated",
    attribution: openGameArtAttribution("LonesomeDucky", "tool-pack-2", 1452),
  },
  {
    file: "opengameart/animated-utility-knife.glb",
    label: "Animated Utility Knife",
    category: "Animated",
    attribution: openGameArtAttribution("LonesomeDucky", "tool-pack-2", 576),
  },
  { file: "AnimatedMushnub.glb", label: "Animated Mushnub", category: "Animated" },
  { file: "AnimatedSnake.glb", label: "Animated Snake", category: "Animated" },
  { file: "Bat.glb", category: "Animals" },
  { file: "Bear.glb", category: "Animals" },
  { file: "Cat.glb", category: "Animals" },
  { file: "Cheetah.glb", category: "Animals" },
  { file: "Deer.glb", category: "Animals" },
  { file: "Dinosaur.glb", category: "Animals" },
  { file: "Dog.glb", category: "Animals" },
  { file: "Dolphin.glb", category: "Animals" },
  { file: "Dragon.glb", category: "Animals" },
  { file: "Duck.glb", category: "Animals" },
  { file: "Elephant.glb", category: "Animals" },
  { file: "Fly.glb", category: "Animals" },
  { file: "Frog.glb", category: "Animals" },
  { file: "Gorilla.glb", category: "Animals" },
  { file: "Hippo.glb", category: "Animals" },
  { file: "Horse.glb", category: "Animals" },
  { file: "Koala.glb", category: "Animals" },
  { file: "Lobster.glb", category: "Animals" },
  { file: "Octopus.glb", category: "Animals" },
  { file: "Owl.glb", category: "Animals" },
  { file: "Pig.glb", category: "Animals" },
  { file: "Poodle.glb", category: "Animals" },
  { file: "Rat.glb", category: "Animals" },
  { file: "Robin.glb", category: "Animals" },
  { file: "Scorpion.glb", category: "Animals" },
  { file: "Shark.glb", category: "Animals" },
  { file: "Snail.glb", category: "Animals" },
  { file: "Wolf.glb", category: "Animals" },
  { file: "Zebra.glb", category: "Animals" },
  { file: "Bicycle.glb", category: "Vehicles" },
  { file: "Dump truck.glb", label: "Dump Truck", category: "Vehicles" },
  { file: "Policecar.glb", label: "Police Car", category: "Vehicles" },
  { file: "Taxi.glb", category: "Vehicles" },
  { file: "Truck.glb", category: "Vehicles" },
  { file: "Acousticguitar.glb", label: "Guitar (Acoustic)", category: "Instruments" },
  { file: "Electricguitar.glb", label: "Guitar (Electric)", category: "Instruments" },
  { file: "Saxophone.glb", category: "Instruments" },
  { file: "Trumpet.glb", category: "Instruments" },
  { file: "Violin.glb", category: "Instruments" },
  { file: "apple.glb", label: "Apple", category: "Food & Drink" },
  { file: "BottleChampagne.glb", label: "Champagne Bottle", category: "Food & Drink" },
  { file: "Eggplant.glb", category: "Food & Drink" },
  { file: "Grapes.glb", category: "Food & Drink" },
  { file: "Hot dog.glb", label: "Hot Dog", category: "Food & Drink" },
  { file: "Watermelon.glb", category: "Food & Drink" },
  { file: "Cactus.glb", category: "Environment" },
  { file: "Campfire.glb", category: "Environment" },
  { file: "Drill.glb", category: "Objects" },
  { file: "Globe.glb", category: "Objects" },
];

const POLY_PIZZA_PRESET_FILES: GalleryPresetFile[] = [
  {
    file: "poly-pizza/fruit-crate.glb",
    label: "Fruit Crate",
    category: "Food & Drink",
    attribution: {
      creator: "BlenderVoyage",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/aXulVWHOeV",
      tris: 196,
    },
  },
  {
    file: "poly-pizza/pizza-slice.glb",
    label: "Pizza Slice",
    category: "Food & Drink",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/CA4HtaaMJn",
      tris: 392,
    },
  },
  {
    file: "poly-pizza/sheep.glb",
    label: "Sheep",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/C39AUXUUes",
      tris: 610,
    },
  },
  {
    file: "poly-pizza/large-building.glb",
    label: "Large Building",
    category: "Architecture",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/yKo7F36Qk2",
      tris: 950,
    },
  },
  {
    file: "poly-pizza/animated-robot.glb",
    label: "Animated Robot",
    category: "Animated",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/QCm7qe9uNJ",
      tris: 1425,
    },
  },
  {
    file: "poly-pizza/bird.glb",
    label: "Bird",
    category: "Animals",
    galleryBucket: "Textured",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/gYYC0gYMnw",
      tris: 1204,
    },
  },
  {
    file: "poly-pizza/cow.glb",
    label: "Cow",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/5XSc2Fka3F",
      tris: 796,
    },
  },
  {
    file: "poly-pizza/ducky.glb",
    label: "Ducky",
    category: "Animals",
    galleryBucket: "Textured",
    attribution: {
      creator: "Isa Lousberg",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/gt2eYOyOvU",
      tris: 604,
    },
  },
  {
    file: "poly-pizza/fish.glb",
    label: "Fish",
    category: "Animals",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/HkUAXudvBt",
      tris: 233,
    },
  },
  {
    file: "poly-pizza/llama.glb",
    label: "Llama",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/JxVJ9rfWGy",
      tris: 661,
    },
  },
  {
    file: "poly-pizza/pug.glb",
    label: "Pug",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/1gXKv15ik8",
      tris: 644,
    },
  },
  {
    file: "poly-pizza/guard-tower.glb",
    label: "Guard Tower",
    category: "Architecture",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/sbaM8I229r",
      tris: 344,
    },
  },
  {
    file: "poly-pizza/house.glb",
    label: "House",
    category: "Architecture",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/7VSVwAg2T3",
      tris: 381,
    },
  },
  {
    file: "poly-pizza/skyscraper.glb",
    label: "Skyscraper",
    category: "Architecture",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/XST1j6kYsL",
      tris: 456,
    },
  },
  {
    file: "poly-pizza/tower.glb",
    label: "Tower",
    category: "Architecture",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/5lvG0WtuTU",
      tris: 683,
    },
  },
  {
    file: "poly-pizza/two-story-house.glb",
    label: "Two story house",
    category: "Architecture",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/sGgL4Nt7I7",
      tris: 630,
    },
  },
  {
    file: "poly-pizza/watch-tower.glb",
    label: "Watch Tower",
    category: "Architecture",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/f2J0aSLVi4",
      tris: 656,
    },
  },
  {
    file: "poly-pizza/bucket.glb",
    label: "Bucket",
    category: "Objects",
    galleryBucket: "Textured",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/tKTttwROq7",
      tris: 532,
    },
  },
  {
    file: "poly-pizza/can.glb",
    label: "Can",
    category: "Objects",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/YnowJvWqxE",
      tris: 428,
    },
  },
  {
    file: "poly-pizza/bread.glb",
    label: "Bread",
    category: "Food & Drink",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/luo9BHRaax",
      tris: 116,
    },
  },
  {
    file: "poly-pizza/cup-tea.glb",
    label: "Cup Tea",
    category: "Food & Drink",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/FUSyrlibw0",
      tris: 108,
    },
  },
  {
    file: "poly-pizza/egg-fried.glb",
    label: "Egg Fried",
    category: "Food & Drink",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/NVrB2yd66v",
      tris: 101,
    },
  },
  {
    file: "poly-pizza/rock.glb",
    label: "Rock",
    category: "Environment",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/cBqdRdLDDL",
      tris: 120,
    },
  },
  {
    file: "poly-pizza/rock-medium.glb",
    label: "Rock Medium",
    category: "Environment",
    galleryBucket: "Textured",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/s1OJ3bBzqc",
      tris: 342,
    },
  },
  {
    file: "poly-pizza/box.glb",
    label: "Box",
    category: "Objects",
    galleryBucket: "Textured",
    attribution: {
      creator: "Kay Lousberg",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/ykZ23x9d6p",
      tris: 32,
    },
  },
  {
    file: "poly-pizza/empty-box.glb",
    label: "Empty Box",
    category: "Objects",
    galleryBucket: "Textured",
    attribution: {
      creator: "CreativeTrio",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/pZBpmjtvw8",
      tris: 76,
    },
  },
  {
    file: "poly-pizza/animated-human.glb",
    label: "Animated Human",
    category: "Characters",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/c3Ibh9I3udk",
      tris: 1578,
    },
  },
  {
    file: "poly-pizza/character-animated.glb",
    label: "Character Animated",
    category: "Characters",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/DgOCW9ZCRJ",
      tris: 1246,
    },
  },
  {
    file: "poly-pizza/human-dude-guy.glb",
    label: "Human Dude Guy",
    category: "Characters",
    attribution: {
      creator: "hat_my_guy",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/83DpVkzvWk",
      tris: 1151,
    },
  },
  {
    file: "poly-pizza/man.glb",
    label: "Man",
    category: "Characters",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/HMnuH5geEG",
      tris: 1216,
    },
  },
  {
    file: "poly-pizza/rabbit-blond.glb",
    label: "Rabbit Blond",
    category: "Characters",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/cMsI6FDhNx",
      tris: 1570,
    },
  },
  {
    file: "poly-pizza/arrow.glb",
    label: "Arrow",
    category: "Weapons",
    galleryBucket: "Textured",
    attribution: {
      creator: "CreativeTrio",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/dZVjrxZdaB",
      tris: 119,
    },
  },
  {
    file: "poly-pizza/sword.glb",
    label: "Sword",
    category: "Weapons",
    attribution: {
      creator: "hat_my_guy",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/FvUHJZzy1M",
      tris: 141,
    },
  },
];

const VOX_PRESET_FILES: GalleryPresetFile[] = [
  {
    file: "AncientCrashSite.vox",
    label: "Ancient Crash Site",
    category: "VOX",
    targetSize: 70,
    zoom: 0.35,
    attribution: MONOGON_ANCIENT_ENVIRONMENT_ATTRIBUTION,
  },
  { file: "army.vox", label: "Army", category: "VOX", attribution: MINI_MIKES_METRO_MINIS_ATTRIBUTION },
  { file: "desert.vox", label: "Desert", category: "VOX", attribution: MONOGON_DESERT_TOWN_ATTRIBUTION },
  { file: "desert2.vox", label: "Desert 2", category: "VOX", attribution: MONOGON_DESERT_TOWN_ATTRIBUTION },
  { file: "Garden.vox", category: "VOX", attribution: MONOGON_TINY_VOXEL_DUNGEON_ATTRIBUTION },
  { file: "Building03.vox", label: "Building 03", category: "VOX", attribution: MONOGON_DESERT_TOWN_ATTRIBUTION },
  { file: "HUT.vox", label: "Hut", category: "VOX", attribution: MONOGON_COUNTRY_SIDE_ATTRIBUTION },
  { file: "house.vox", label: "House", category: "VOX", attribution: MINI_MIKES_METRO_MINIS_ATTRIBUTION },
  { file: "pyramid.vox", label: "Pyramid", category: "VOX", attribution: MONOGON_ANCIENT_ENVIRONMENT_ATTRIBUTION },
  { file: "skyscraper.vox", label: "Skyscraper", category: "VOX", attribution: MONOGON_CYBERPUNK_CITY_ATTRIBUTION },
  { file: "stairs.vox", label: "Stairs", category: "VOX", attribution: MONOGON_TINY_VOXEL_DUNGEON_ATTRIBUTION },
  { file: "Plane_03.vox", label: "Plane 03", category: "VOX", attribution: MONOGON_VOXEL_PLANE_ATTRIBUTION },
  { file: "bus.vox", label: "Bus", category: "VOX", attribution: MINI_MIKES_METRO_MINIS_ATTRIBUTION },
  { file: "tank.vox", label: "Tank", category: "VOX", attribution: MINI_MIKES_METRO_MINIS_ATTRIBUTION },
  { file: "arachnoid.vox", label: "Arachnoid", category: "VOX", attribution: MONOGON_VOXEL_MECHAS_ATTRIBUTION },
  { file: "MechaGolem.vox", label: "Mecha Golem", category: "VOX", attribution: MONOGON_VOXEL_MECHAS_ATTRIBUTION },
  { file: "mecha.vox", label: "Mecha", category: "VOX", attribution: MONOGON_VOXEL_MECHAS_ATTRIBUTION },
  { file: "StarMarineTrooper.vox", label: "Star Marine Trooper", category: "VOX", attribution: MONOGON_VOXEL_SPACESHIPS_ATTRIBUTION },
  { file: "apple.vox", label: "Apple", category: "VOX", attribution: SONA_SAR_VOXEL_ANIMALS_ITEMS_ATTRIBUTION },
  { file: "dual.vox", label: "Dual", category: "VOX", attribution: MONOGON_VOXEL_SPACESHIPS_ATTRIBUTION },
  { file: "Treasure.vox", category: "VOX", attribution: MONOGON_ANCIENT_ENVIRONMENT_ATTRIBUTION },
  { file: "tree.vox", label: "Tree", category: "VOX", attribution: MINI_MIKES_METRO_MINIS_ATTRIBUTION },
];

const ULTIMATE_SPACESHIPS_ROOT = "quaternius/ultimate-spaceships";

function ultimateSpaceshipPreset(
  slug: string,
  name: string,
  texture: string,
  tris: number,
): ObjGalleryPresetFile {
  return {
    file: `${ULTIMATE_SPACESHIPS_ROOT}/${slug}/${name}.obj`,
    label: `Ship - ${name}`,
    category: "Vehicles",
    galleryBucket: "Textured",
    zoom: 0.24,
    attribution: { ...QUATERNIUS_ULTIMATE_SPACESHIPS_ATTRIBUTION, tris },
    options: {
      materialTextures: {
        Texture: `/gallery/obj/${ULTIMATE_SPACESHIPS_ROOT}/${slug}/${texture}`,
      },
    },
  };
}

const OBJ_PRESET_FILES: ObjGalleryPresetFile[] = [
  {
    file: "opengameart/crate/Box.obj",
    label: "Crate",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.45,
    attribution: openGameArtAttribution("Kutejnikov", "crate-5", 12),
  },
  {
    file: "opengameart/hay-bale/hay_bale.obj",
    label: "Hay Bale",
    category: "Environment",
    galleryBucket: "Textured",
    zoom: 0.45,
    attribution: openGameArtAttribution("Mish7913", "hay-bale-0", 108),
  },
  {
    file: "opengameart/low-poly-car/car.obj",
    label: "Low Poly Car",
    category: "Vehicles",
    galleryBucket: "Textured",
    zoom: 0.3,
    attribution: openGameArtAttribution("drummyfish", "low-poly-car-3", 228),
  },
  {
    file: "opengameart/wood-crate/woodcrate.obj",
    label: "Wood Crate",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.4,
    attribution: openGameArtAttribution("GGBotNet", "wood-crate-3d", 284),
  },
  {
    file: "opengameart/broken-stone-slab/stone.obj",
    label: "Broken Stone Slab",
    category: "Environment",
    galleryBucket: "Textured",
    zoom: 0.4,
    attribution: openGameArtAttribution("Kutejnikov", "broken-stone-slab", 186),
  },
  {
    file: "opengameart/frog-guy/frog.obj",
    label: "Frog Guy",
    category: "Characters",
    galleryBucket: "Textured",
    zoom: 0.35,
    attribution: openGameArtAttribution("drummyfish", "frog-guy", 356),
  },
  {
    file: "opengameart/game-cartridge/cartridge.obj",
    label: "Game Cartridge",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.4,
    attribution: openGameArtAttribution("Kutejnikov", "game-cartridge", 432, "CC-BY 4.0"),
  },
  {
    file: "opengameart/fire-extinguisher/extinguisher.obj",
    label: "Fire Extinguisher",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.35,
    attribution: openGameArtAttribution("cron", "fire-extinguisher-2", 818, "CC-BY-SA 4.0"),
  },
  {
    file: "opengameart/keycard/keycard.obj",
    label: "Keycard",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.45,
    attribution: openGameArtAttribution("codeinfernogames", "3d-keycard", 20),
  },
  {
    file: "opengameart/pirate-coin/pirate-coin.obj",
    label: "Pirate Coin",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.4,
    attribution: openGameArtAttribution("acasas", "3d-pirate-coin", 624, "CC-BY 3.0"),
  },
  {
    file: "opengameart/perfume-bottle/perfume.obj",
    label: "Perfume Bottle",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.4,
    attribution: openGameArtAttribution("PantherOne", "perfume-bottle-persian", 196, "CC-BY 3.0"),
  },
  {
    file: "opengameart/grandfather-clock/grandfather-clock.obj",
    label: "Grandfather Clock",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.35,
    attribution: openGameArtAttribution("GGBotNet", "grandfather-clock-3d", 106, "CC-BY 4.0"),
  },
  {
    file: "opengameart/old-book/old-book.obj",
    label: "Old Book",
    category: "Objects",
    galleryBucket: "Textured",
    zoom: 0.4,
    attribution: openGameArtAttribution("GGBotNet", "old-bible-3d", 60, "CC-BY 4.0"),
  },
  {
    file: "opengameart/haunted-house/hauntedhouse.obj",
    label: "Haunted House",
    category: "Buildings",
    galleryBucket: "Textured",
    zoom: 0.35,
    attribution: openGameArtAttribution("naovia", "haunted-house", 377),
  },
  {
    file: "opengameart/biplane/biplane.obj",
    label: "Low Poly Biplane",
    category: "Vehicles",
    galleryBucket: "Textured",
    zoom: 0.25,
    attribution: openGameArtAttribution("mfep", "low-poly-biplane", 668),
  },
  ultimateSpaceshipPreset("challenger", "Challenger", "Challenger_Green.png", 1748),
  ultimateSpaceshipPreset("executioner", "Executioner", "Executioner_Blue.png", 3388),
  ultimateSpaceshipPreset("omen", "Omen", "Omen_Orange.png", 1426),
  ultimateSpaceshipPreset("pancake", "Pancake", "Pancake_Orange.png", 2688),
  ultimateSpaceshipPreset("spitfire", "Spitfire", "Spitfire_Red.png", 3512),
  ultimateSpaceshipPreset("zenith", "Zenith", "Zenith_Red.png", 2152),
  {
    file: "quaternius/nature/Lilypad.obj",
    label: "Lilypad",
    category: "Environment",
    zoom: 0.45,
    attribution: quaterniusAttribution("https://quaternius.com/packs/ultimatenature.html", 372),
  },
  {
    file: "quaternius/dungeon/Chest_gold.obj",
    label: "Treasure Chest",
    category: "Objects",
    zoom: 0.4,
    attribution: quaterniusAttribution("https://quaternius.com/packs/medievaldungeon.html", 436),
  },
  {
    file: "quaternius/dungeon/Torch.obj",
    label: "Torch",
    category: "Objects",
    zoom: 0.35,
    attribution: quaterniusAttribution("https://quaternius.com/packs/medievaldungeon.html", 518),
  },
  {
    file: "quaternius/dungeon/Candelabrum.obj",
    label: "Candelabrum",
    category: "Objects",
    zoom: 0.35,
    attribution: quaterniusAttribution("https://quaternius.com/packs/medievaldungeon.html", 636),
  },
];

const PRESETS: PresetModel[] = [
  {
    id: "chicken",
    label: "Chicken",
    category: "Characters",
    kind: "obj",
    url: "/gallery/obj/chicken.obj",
    mtlUrl: "/gallery/obj/chicken.mtl",
    options: { targetSize: 60, defaultColor: "#cccccc" },
    zoom: 0.15,
    rotX: 74.4,
    rotY: 301.6,
    attribution: GOOGLE_POLY_AMBER_ATTRIBUTION,
  },
  {
    id: "sting",
    label: "Sting Sword (UV-mapped)",
    category: "Weapons",
    kind: "obj",
    url: "/gallery/obj/sting.obj",
    options: {
      targetSize: 60,
      defaultColor: "#cccccc",
      materialTextures: { Sting: "/gallery/obj/sting-diffuse.png" },
    },
    galleryBucket: "Textured",
    zoom: 0.3,
    rotX: 65,
    rotY: 45,
    attribution: KANGAROOZ_STING_ATTRIBUTION,
  },
  {
    id: "cottage",
    label: "Cottage (UV-mapped)",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/cottage.obj",
    options: {
      targetSize: 60,
      defaultColor: "#a0a0a0",
      materialTextures: { cottage_texture: "/gallery/obj/cottage-diffuse.png" },
      includeObjects: ["Cube_Cube.002"],
    },
    galleryBucket: "Textured",
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
    attribution: PROJECT_CHRONO_OFFROAD_ATTRIBUTION,
  },
  {
    id: "rock1",
    label: "Rock (UV-mapped)",
    category: "Environment",
    kind: "obj",
    url: "/gallery/obj/rock1.obj",
    mtlUrl: "/gallery/obj/rock1.mtl",
    options: { targetSize: 40, defaultColor: "#8b6f47", excludeObjects: ["Plane"] },
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
    options: { targetSize: 60 },
    galleryBucket: "Textured",
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
    attribution: { ...QUATERNIUS_ULTIMATE_SPACESHIPS_ATTRIBUTION, tris: 3012 },
  },
  {
    id: "apoc-car",
    label: "Apocalypse Car (GLB)",
    category: "Vehicles",
    kind: "glb",
    url: "/gallery/glb/apocalypse/car.glb",
    options: { targetSize: 60 },
    galleryBucket: "Textured",
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
    attribution: ATOMIC_REALM_POST_APOCALYPTIC_ATTRIBUTION,
  },
  {
    id: "apoc-barrel",
    label: "Apocalypse Barrel (GLB)",
    category: "Objects",
    kind: "glb",
    url: "/gallery/glb/apocalypse/barrel.glb",
    options: { targetSize: 50 },
    galleryBucket: "Textured",
    zoom: 0.5,
    rotX: 65,
    rotY: 45,
    attribution: ATOMIC_REALM_POST_APOCALYPTIC_ATTRIBUTION,
  },
  {
    id: "apoc-spike",
    label: "Spike Barricade (GLB)",
    category: "Objects",
    kind: "glb",
    url: "/gallery/glb/apocalypse/wooden_spike_barricade.glb",
    options: { targetSize: 60 },
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
    options: { targetSize: 60 },
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
    options: { targetSize: 60, defaultColor: "#94a3b8" },
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
    options: { targetSize: 60 },
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
    options: { targetSize: 60, defaultColor: "#a3a3a3" },
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
    options: { targetSize: 60 },
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
    options: { targetSize: 80, palette: ["#c9a876", "#a78760", "#8b6f47", "#6b5538"] },
    zoom: 0.15,
    rotX: 65,
    rotY: 45,
  },
  ...OBJ_PRESET_FILES.map(objPreset),
  ...GLB_PRESET_FILES.map(glbPreset),
  ...POLY_PIZZA_PRESET_FILES.map(glbPreset),
  ...VOX_PRESET_FILES.map(voxPreset),
];

function presetPickerItem(preset: PresetModel, local = false) {
  return {
    id: preset.id,
    label: local ? `Dropped: ${stripParenthesizedText(preset.label)}` : stripParenthesizedText(preset.label),
    category: galleryBucketForPreset(preset),
  };
}

const PRESET_PICKER_ITEMS = PRESETS.map((preset) => presetPickerItem(preset));

const DEFAULT_SCENE: SceneOptionsState = {
  renderer: "vanilla",
  animationPaused: false,
  animationTimeScale: 1,
  autoCenter: true,
  interactive: true,
  animate: false,
  showAxes: false,
  selection: false,
  hoverEffects: false,
  showLight: false,
  zoom: PRESETS[0].zoom ?? 0.35,
  rotX: PRESETS[0].rotX ?? 65,
  rotY: PRESETS[0].rotY ?? 45,
  perspective: false,
  lightAzimuth: 50,
  lightElevation: 45,
  lightIntensity: 1,
  lightColor: "#ffffff",
  ambientIntensity: 0.4,
  ambientColor: "#ffffff",
  textureLighting: "baked",
  textureQuality: "auto",
  experimentalTextureEdgeRepair: true,
  matrixPrecision: "exact",
  borderShapePrecision: "exact",
  meshResolution: "lossy",
  meshInteriorFill: false,
  outlinePolygons: false,
  dragMode: "orbit",
  target: [0, 0, 0],
  disableStrategies: [],
  castShadow: false,
  showGround: false,
};

const DEFAULT_PARSER: ParserOptionsState = {
  targetSize: 60,
  gridShift: 1,
  defaultColor: "#8b95a1",
};

const DROPPED_MESH_EXTENSIONS = new Set(["obj", "glb", "vox"]);

interface DroppedFileIndex {
  byPath: Map<string, File>;
  byBasename: Map<string, File[]>;
}

function fileListToArray(fileList: FileList | null): File[] {
  const files: File[] = [];
  if (!fileList) return files;
  for (let i = 0; i < fileList.length; i += 1) {
    const file = fileList.item(i);
    if (file) files.push(file);
  }
  return files;
}

function dataTransferHasFiles(dataTransfer: DataTransfer): boolean {
  for (let i = 0; i < dataTransfer.types.length; i += 1) {
    if (dataTransfer.types[i] === "Files") return true;
  }
  return false;
}

function fileExtension(name: string): string {
  const clean = name.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

function droppedKindForFile(file: File): DroppedModelSource["kind"] | null {
  const ext = fileExtension(file.name);
  if (ext === "obj" || ext === "glb" || ext === "vox") return ext;
  return null;
}

function droppedFilePath(file: File): string {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return withRelativePath.webkitRelativePath || file.name;
}

function normalizeDroppedPath(value: string): string {
  let normalized = value.trim().replace(/\\+/g, "/").replace(/^\.\/+/, "");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original path when it is not URI encoded.
  }
  return normalized.toLowerCase();
}

function droppedBasename(value: string): string {
  const normalized = normalizeDroppedPath(value);
  return normalized.split("/").pop() ?? normalized;
}

function buildDroppedFileIndex(files: File[]): DroppedFileIndex {
  const byPath = new Map<string, File>();
  const byBasename = new Map<string, File[]>();
  for (const file of files) {
    const path = normalizeDroppedPath(droppedFilePath(file));
    byPath.set(path, file);
    byPath.set(normalizeDroppedPath(file.name), file);

    const base = droppedBasename(file.name);
    const bucket = byBasename.get(base) ?? [];
    bucket.push(file);
    byBasename.set(base, bucket);
  }
  return { byPath, byBasename };
}

function findDroppedFile(index: DroppedFileIndex, path: string): File | null {
  const normalized = normalizeDroppedPath(path);
  return index.byPath.get(normalized) ?? index.byBasename.get(droppedBasename(normalized))?.[0] ?? null;
}

function extractObjMtllibRefs(objText: string): string[] {
  const refs: string[] = [];
  for (const raw of objText.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("mtllib ")) continue;
    const rest = line.slice(7).trim();
    if (!rest) continue;
    refs.push(rest);
    for (const token of rest.split(/\s+/)) {
      if (token.toLowerCase().endsWith(".mtl")) refs.push(token);
    }
  }
  return Array.from(new Set(refs));
}

function findDroppedMtlFiles(objText: string, files: File[], index: DroppedFileIndex): File[] {
  const matched = new Map<string, File>();
  for (const ref of extractObjMtllibRefs(objText)) {
    const file = findDroppedFile(index, ref);
    if (file) matched.set(droppedFilePath(file), file);
  }
  if (matched.size > 0) return Array.from(matched.values());

  const mtlFiles = files.filter((file) => fileExtension(file.name) === "mtl");
  return mtlFiles.length === 1 ? mtlFiles : [];
}

function droppedSourceFromFiles(files: File[], id: string): DroppedModelSource | null {
  const primaryFile = files.find((file) => DROPPED_MESH_EXTENSIONS.has(fileExtension(file.name)));
  if (!primaryFile) return null;

  const kind = droppedKindForFile(primaryFile);
  if (!kind) return null;

  const label = labelFromFile(primaryFile.name) || primaryFile.name;
  const preset: PresetModel = {
    id,
    label,
    kind,
    category: "Dropped",
    url: "",
    options: {
      targetSize: 60,
      gridShift: kind === "vox" ? 0 : 1,
      defaultColor: DEFAULT_PARSER.defaultColor,
    },
    zoom: kind === "vox" ? 0.4 : 0.35,
    rotX: 65,
    rotY: 45,
    attribution: { creator: "Local file" },
  };

  return {
    id,
    label,
    kind,
    primaryFile,
    files,
    preset,
  };
}

function parserDefaultsFor(model: PresetModel): Partial<ParserOptionsState> {
  const options = model.options as (ObjParseOptions & GltfParseOptions & VoxParseOptions) | undefined;
  return {
    ...(typeof options?.targetSize === "number" ? { targetSize: options.targetSize } : {}),
    ...(typeof options?.gridShift === "number" ? { gridShift: options.gridShift } : {}),
    ...(typeof options?.defaultColor === "string" ? { defaultColor: options.defaultColor } : {}),
  };
}

function randomPreset(): PresetModel {
  return PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? PRESETS[0];
}

function hashStringToUint32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function routeIdForPresetId(presetId: string): string {
  return String(hashStringToUint32(presetId));
}

function getRoutePresetValue(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("model") || "";
}

function resolveRoutePresetId(routeValue: string): string {
  const value = typeof routeValue === "string" ? routeValue.trim() : "";
  if (!value) return "";

  if (/^\d+$/.test(value)) {
    const preset = PRESETS.find((candidate) => routeIdForPresetId(candidate.id) === value);
    if (preset) return preset.id;
  }

  const preset = PRESETS.find((candidate) => candidate.id === value);
  return preset?.id ?? "";
}

function routeInitialPreset(): PresetModel | null {
  const routePresetId = resolveRoutePresetId(getRoutePresetValue());
  return routePresetId ? PRESETS.find((preset) => preset.id === routePresetId) ?? null : null;
}

function setRoutePresetId(presetId: string | null): void {
  if (typeof window === "undefined") return;
  const next = presetId ? routeIdForPresetId(presetId) : "";
  const current = getRoutePresetValue();
  if (next === current) return;

  const params = new URLSearchParams(window.location.search);
  if (next) params.set("model", next);
  else params.delete("model");

  const newSearch = params.toString();
  const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", newUrl);
}

function sceneDefaultsFor(model: PresetModel): SceneOptionsState {
  return {
    ...DEFAULT_SCENE,
    zoom: model.zoom ?? DEFAULT_SCENE.zoom,
    rotX: model.rotX ?? DEFAULT_SCENE.rotX,
    rotY: model.rotY ?? DEFAULT_SCENE.rotY,
  };
}

function parserStateFor(model: PresetModel): ParserOptionsState {
  return {
    ...DEFAULT_PARSER,
    ...parserDefaultsFor(model),
  };
}

const EMPTY_METRICS: DomMetrics = {
  measuredAt: 0,
  nodeCount: 0,
  sprites: 0,
  rects: 0,
  triangles: 0,
  irregular: 0,
  overpaintPercent: 0,
};

const DEBUG_SHAPE_LABELS = {
  rectangle: "Rects <b>",
  triangle: "Triangles <u>",
  irregular: "Polygons <i>",
};

type AxisIndex = 0 | 1 | 2;
type Point2 = [number, number];

interface Segment2 {
  a: Point2;
  b: Point2;
}

interface InteriorFillInterval {
  row: number;
  y: number;
  x0: number;
  x1: number;
  length: number;
}

interface InteriorFillSlice {
  points: Point2[];
  planeValue: number;
  area: number;
  center: Point2;
}

interface InteriorFillPlaneSlice {
  fixedAxis: AxisIndex;
  axisA: AxisIndex;
  axisB: AxisIndex;
  slice: InteriorFillSlice;
}

interface PolygonBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  span: Vec3;
  diagonal: number;
  maxSpan: number;
}

const INTERIOR_FILL_MIN_MAX_SPAN = 8;
const INTERIOR_FILL_MIN_DIAGONAL = 10;
const INTERIOR_FILL_SOLID_COVERAGE_MIN = 0.2;
const INTERIOR_FILL_MIN_PLANE_AREA_RATIO = 0.12;
const INTERIOR_FILL_MIN_SLICE_AREA_RATIO = 0.01;
const INTERIOR_FILL_SCAN_ROWS = 72;
const INTERIOR_FILL_GRID_COLUMNS = 96;
const INTERIOR_FILL_SLICE_SAMPLES = 31;
const INTERIOR_FILL_SLICE_MARGIN = 0.08;
const INTERIOR_FILL_EXTRA_SLICE_MIN_AREA_RATIO = 0.35;
const INTERIOR_FILL_MIN_PLANE_SEPARATION_RATIO = 0.14;
const INTERIOR_FILL_OPEN_RADIUS_RATIO = 0.06;
const INTERIOR_FILL_END_TRIM_LENGTH_RATIO = 0.45;
const INTERIOR_FILL_END_TRIM_MIN_ROWS = 6;
const INTERIOR_FILL_SIDE_TRIM_WINDOW = 2;
const INTERIOR_FILL_SIDE_TRIM_QUANTILE = 0.6;
const INTERIOR_FILL_SIDE_TRIM_MIN_LENGTH_RATIO = 0.24;
const INTERIOR_FILL_INTERVAL_MIN_LENGTH_RATIO = 0.28;
const INTERIOR_FILL_INTERVAL_OVERLAP_RATIO = 0.08;
const INTERIOR_FILL_MIN_INTERVAL_ROWS = 4;
const INTERIOR_FILL_INSET_DISTANCE_RATIO = 0.025;
const INTERIOR_FILL_INSET_MAX_DISTANCE_RATIO = 0.08;
const INTERIOR_FILL_MAX_MITER_RATIO = 4;
const INTERIOR_FILL_SECONDARY_COMPONENT_AREA_RATIO = 0.68;
const INTERIOR_FILL_MAX_COMPONENTS_PER_SLICE = 2;
const INTERIOR_FILL_MAX_PLANES = 6;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function polygonArea(polygon: Polygon): number {
  const [origin] = polygon.vertices;
  if (!origin || polygon.vertices.length < 3) return 0;
  let area = 0;
  for (let i = 1; i < polygon.vertices.length - 1; i += 1) {
    const a = polygon.vertices[i];
    const b = polygon.vertices[i + 1];
    const ax = a[0] - origin[0];
    const ay = a[1] - origin[1];
    const az = a[2] - origin[2];
    const bx = b[0] - origin[0];
    const by = b[1] - origin[1];
    const bz = b[2] - origin[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    area += Math.hypot(cx, cy, cz) * 0.5;
  }
  return area;
}

function polygonBounds(polygons: Polygon[]): PolygonBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX)) return null;
  const span: Vec3 = [maxX - minX, maxY - minY, maxZ - minZ];
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ],
    span,
    diagonal: Math.hypot(span[0], span[1], span[2]),
    maxSpan: Math.max(span[0], span[1], span[2]),
  };
}

function dominantSolidColor(polygons: Polygon[]): string | null {
  let totalWeight = 0;
  let solidWeight = 0;
  const weights = new Map<string, number>();

  for (const polygon of polygons) {
    const weight = Math.max(polygonArea(polygon), 1e-4);
    totalWeight += weight;
    if (polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length) continue;

    const color = solidColorToHex(polygon.color ?? "#cccccc");
    if (!color) continue;
    solidWeight += weight;
    weights.set(color, (weights.get(color) ?? 0) + weight);
  }

  if (totalWeight <= 0 || solidWeight / totalWeight < INTERIOR_FILL_SOLID_COVERAGE_MIN) {
    return null;
  }

  let bestColor: string | null = null;
  let bestWeight = 0;
  for (const [color, weight] of weights) {
    if (weight > bestWeight) {
      bestColor = color;
      bestWeight = weight;
    }
  }
  return bestColor;
}

function withInteriorFillPolygons(polygons: Polygon[]): Polygon[] {
  const fill = interiorFillPolygons(polygons);
  return fill.length > 0 ? [...fill, ...polygons] : polygons;
}

function interiorFillPolygons(polygons: Polygon[]): Polygon[] {
  const bounds = polygonBounds(polygons);
  if (!bounds) return [];
  if (
    bounds.maxSpan < INTERIOR_FILL_MIN_MAX_SPAN ||
    bounds.diagonal < INTERIOR_FILL_MIN_DIAGONAL
  ) {
    return [];
  }

  const color = dominantSolidColor(polygons);
  if (!color) return [];

  let targetPlaneCount = automaticInteriorFillPlaneCount(polygons, bounds);
  const candidates = [
    { fixedAxis: 2 as AxisIndex, axisA: 0 as AxisIndex, axisB: 1 as AxisIndex, area: bounds.span[0] * bounds.span[1] },
    { fixedAxis: 1 as AxisIndex, axisA: 0 as AxisIndex, axisB: 2 as AxisIndex, area: bounds.span[0] * bounds.span[2] },
    { fixedAxis: 0 as AxisIndex, axisA: 1 as AxisIndex, axisB: 2 as AxisIndex, area: bounds.span[1] * bounds.span[2] },
  ].sort((a, b) => b.area - a.area);

  const maxArea = candidates[0]?.area ?? 0;
  const minArea = maxArea * INTERIOR_FILL_MIN_PLANE_AREA_RATIO;
  const groups: InteriorFillPlaneSlice[][] = [];
  for (const candidate of candidates) {
    if (candidate.area <= minArea) continue;
    const slices = interiorFillCandidateSlices(
      polygons,
      bounds,
      candidate.fixedAxis,
      candidate.axisA,
      candidate.axisB,
      candidate.area,
      INTERIOR_FILL_MAX_PLANES,
    );
    if (slices.length === 0) continue;
    groups.push(slices.map((slice): InteriorFillPlaneSlice => ({
      fixedAxis: candidate.fixedAxis,
      axisA: candidate.axisA,
      axisB: candidate.axisB,
      slice,
    })));
  }
  if (groups.some(hasComparableCoPlanarCavities)) {
    targetPlaneCount = Math.min(INTERIOR_FILL_MAX_PLANES, targetPlaneCount + 1);
  }

  const selected: InteriorFillPlaneSlice[] = [];
  const selectedKeys = new Set<string>();
  const addSlice = (candidate: InteriorFillPlaneSlice): void => {
    const key = interiorFillPlaneSliceKey(candidate);
    if (selectedKeys.has(key) || selected.length >= targetPlaneCount) return;
    selectedKeys.add(key);
    selected.push(candidate);
  };

  for (const group of groups) addSlice(group[0]);
  while (selected.length < targetPlaneCount) {
    let best: InteriorFillPlaneSlice | null = null;
    for (const group of groups) {
      for (let i = 1; i < group.length; i += 1) {
        const candidate = group[i];
        const key = interiorFillPlaneSliceKey(candidate);
        if (selectedKeys.has(key)) continue;
        if (!best || candidate.slice.area > best.slice.area) best = candidate;
      }
    }
    if (!best) break;
    addSlice(best);
  }

  const fill: Polygon[] = [];
  for (const selectedSlice of selected) {
    fill.push(...interiorFillPlaneFromSlice(bounds, selectedSlice, color));
  }
  return fill;
}

function hasComparableCoPlanarCavities(slices: InteriorFillPlaneSlice[]): boolean {
  for (let i = 0; i < slices.length; i += 1) {
    for (let j = i + 1; j < slices.length; j += 1) {
      if (Math.abs(slices[i].slice.planeValue - slices[j].slice.planeValue) > 1e-5) continue;
      if (
        Math.min(slices[i].slice.area, slices[j].slice.area) >=
        Math.max(slices[i].slice.area, slices[j].slice.area) * INTERIOR_FILL_SECONDARY_COMPONENT_AREA_RATIO
      ) {
        return true;
      }
    }
  }
  return false;
}

function interiorFillPlaneSliceKey(candidate: InteriorFillPlaneSlice): string {
  return [
    candidate.fixedAxis,
    candidate.slice.planeValue.toFixed(5),
    candidate.slice.center[0].toFixed(2),
    candidate.slice.center[1].toFixed(2),
  ].join(":");
}

function automaticInteriorFillPlaneCount(polygons: Polygon[], bounds: PolygonBounds): number {
  const nonZeroSpans = bounds.span.filter((span) => span > 1e-6).sort((a, b) => a - b);
  const minSpan = nonZeroSpans[0] ?? bounds.maxSpan;
  const aspect = minSpan > 0 ? bounds.maxSpan / minSpan : 1;
  let planes = 3;
  if (bounds.diagonal >= 28 || polygons.length >= 160 || aspect >= 3) planes = 4;
  if (bounds.diagonal >= 42 || polygons.length >= 360 || aspect >= 4.5) planes = 5;
  if (bounds.diagonal >= 80 && polygons.length >= 1400 && aspect >= 3) planes = 6;
  return Math.min(planes, INTERIOR_FILL_MAX_PLANES);
}

function interiorFillPlaneFromSlice(
  bounds: PolygonBounds,
  plane: InteriorFillPlaneSlice,
  color: string,
): [Polygon, Polygon] {
  const point = ([a, b]: Point2): Vec3 => {
    const vertex = [...bounds.center] as Vec3;
    vertex[plane.fixedAxis] = plane.slice.planeValue;
    vertex[plane.axisA] = a;
    vertex[plane.axisB] = b;
    return vertex;
  };
  const vertices = plane.slice.points.map(point);
  return [
    { vertices, color },
    { vertices: [...vertices].reverse(), color },
  ];
}

function interiorFillCandidateSlices(
  polygons: Polygon[],
  bounds: PolygonBounds,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  candidateArea: number,
  maxSlices: number,
): InteriorFillSlice[] {
  const span = bounds.span[fixedAxis];
  if (!Number.isFinite(span) || span <= 0) return [];

  const candidates: InteriorFillSlice[] = [];
  const usableStart = bounds.min[fixedAxis] + span * INTERIOR_FILL_SLICE_MARGIN;
  const usableSpan = span * (1 - INTERIOR_FILL_SLICE_MARGIN * 2);
  for (let i = 0; i < INTERIOR_FILL_SLICE_SAMPLES; i++) {
    const planeValue = usableStart + ((i + 0.5) / INTERIOR_FILL_SLICE_SAMPLES) * usableSpan;
    const slices = interiorFillSlicePolygons(
      polygons,
      bounds,
      fixedAxis,
      axisA,
      axisB,
      candidateArea,
      planeValue,
    );
    candidates.push(...slices);
  }
  candidates.sort((a, b) => b.area - a.area);
  if (candidates.length === 0) return [];

  const minArea = Math.max(
    candidateArea * INTERIOR_FILL_MIN_SLICE_AREA_RATIO,
    candidates[0].area * INTERIOR_FILL_EXTRA_SLICE_MIN_AREA_RATIO,
  );
  const minSeparation = span * INTERIOR_FILL_MIN_PLANE_SEPARATION_RATIO;
  const selected: InteriorFillSlice[] = [];
  for (const slice of candidates) {
    if (slice.area < minArea) continue;
    if (selected.some((current) =>
      Math.abs(current.planeValue - slice.planeValue) < minSeparation &&
      distance2D(current.center, slice.center) < Math.sqrt(Math.max(current.area, slice.area)) * 0.35
    )) {
      continue;
    }
    selected.push(slice);
    if (selected.length >= maxSlices) break;
  }
  return selected;
}

function interiorFillSlicePolygons(
  polygons: Polygon[],
  bounds: PolygonBounds,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  candidateArea: number,
  planeValue: number,
): InteriorFillSlice[] {
  const tolerance = Math.max(bounds.diagonal * 1e-5, 1e-4);
  const segments: Segment2[] = [];

  for (const polygon of polygons) {
    const segment = slicePolygonAtAxis(polygon, fixedAxis, axisA, axisB, planeValue, tolerance);
    if (segment) segments.push(segment);
  }

  if (segments.length < 3) return [];
  const spanA = bounds.span[axisA];
  const spanB = bounds.span[axisB];
  const first = scanlineCavityPolygons(segments, spanA < spanB, candidateArea, tolerance);
  const second = scanlineCavityPolygons(segments, spanA >= spanB, candidateArea, tolerance);
  const points = first.length === 0
    ? second
    : second.length === 0
      ? first
      : totalLoopArea2D(second) > totalLoopArea2D(first)
        ? second
        : first;
  return points.map((loop): InteriorFillSlice => ({
    points: loop,
    planeValue,
    area: Math.abs(loopArea2D(loop)),
    center: loopCentroid2D(loop),
  }));
}

function slicePolygonAtAxis(
  polygon: Polygon,
  fixedAxis: AxisIndex,
  axisA: AxisIndex,
  axisB: AxisIndex,
  planeValue: number,
  tolerance: number,
): Segment2 | null {
  const vertices = polygon.vertices;
  if (vertices.length < 3) return null;
  if (vertices.every((vertex) => Math.abs(vertex[fixedAxis] - planeValue) <= tolerance)) {
    return null;
  }
  const hits: Point2[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const da = a[fixedAxis] - planeValue;
    const db = b[fixedAxis] - planeValue;

    if (Math.abs(da) <= tolerance && Math.abs(db) <= tolerance) {
      hits.push([a[axisA], a[axisB]], [b[axisA], b[axisB]]);
      continue;
    }
    if (Math.abs(da) <= tolerance) {
      hits.push([a[axisA], a[axisB]]);
      continue;
    }
    if (da * db >= 0) continue;

    const t = da / (da - db);
    hits.push([
      a[axisA] + (b[axisA] - a[axisA]) * t,
      a[axisB] + (b[axisB] - a[axisB]) * t,
    ]);
  }
  const unique = uniquePoints2D(hits, tolerance);
  if (unique.length < 2) return null;

  let a = unique[0];
  let b = unique[1];
  let bestDistance = distance2D(a, b);
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const distance = distance2D(unique[i], unique[j]);
      if (distance > bestDistance) {
        a = unique[i];
        b = unique[j];
        bestDistance = distance;
      }
    }
  }

  return bestDistance > tolerance ? { a, b } : null;
}

function uniquePoints2D(points: Point2[], tolerance: number): Point2[] {
  const cellSize = Math.max(tolerance, 1e-6);
  const seen = new Map<string, Point2>();
  for (const point of points) {
    const key = `${Math.round(point[0] / cellSize)},${Math.round(point[1] / cellSize)}`;
    if (!seen.has(key)) seen.set(key, point);
  }
  return [...seen.values()];
}

function scanlineCavityPolygons(
  segments: Segment2[],
  swapAxes: boolean,
  candidateArea: number,
  tolerance: number,
): Point2[][] {
  const oriented = segments.map((segment): Segment2 => ({
    a: orientPoint2D(segment.a, swapAxes),
    b: orientPoint2D(segment.b, swapAxes),
  }));
  const intervals = scanlineIntervals(oriented, tolerance);
  if (intervals.length === 0) return [];

  const opened = morphologicalCavityPolygons(intervals, candidateArea, tolerance);
  if (opened.length > 0) {
    return opened.map((loop) => loop.map((point) => orientPoint2D(point, swapAxes)));
  }

  const maxLength = Math.max(...intervals.map((interval) => interval.length));
  const minLength = Math.max(maxLength * INTERIOR_FILL_INTERVAL_MIN_LENGTH_RATIO, tolerance * 4);
  const kept = intervals.filter((interval) => interval.length >= minLength);
  if (kept.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) return [];

  const selected = largestIntervalComponent(kept);
  if (selected.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) return [];

  const byRow = new Map<number, InteriorFillInterval>();
  for (const interval of selected) {
    const current = byRow.get(interval.row);
    if (!current || interval.length > current.length) byRow.set(interval.row, interval);
  }
  const rows = [...byRow.values()].sort((a, b) => a.row - b.row);
  if (rows.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) return [];

  const rowStep = rows.length > 1
    ? Math.abs(rows[1].y - rows[0].y)
    : Math.sqrt(candidateArea) / INTERIOR_FILL_SCAN_ROWS;
  const estimatedArea = rows.reduce((sum, row) => sum + row.length * rowStep, 0);
  if (estimatedArea < candidateArea * INTERIOR_FILL_MIN_SLICE_AREA_RATIO) return [];

  const loop = [
    ...rows.map((row): Point2 => [row.x0, row.y]),
    ...rows.slice().reverse().map((row): Point2 => [row.x1, row.y]),
  ].map((point) => orientPoint2D(point, swapAxes));
  const cleaned = cleanLoop2D(loop, tolerance);
  if (cleaned.length < 3) return [];
  return [insetLoop2D(cleaned, tolerance)];
}

function morphologicalCavityPolygons(
  intervals: InteriorFillInterval[],
  candidateArea: number,
  tolerance: number,
): Point2[][] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const interval of intervals) {
    minX = Math.min(minX, interval.x0);
    maxX = Math.max(maxX, interval.x1);
    minY = Math.min(minY, interval.y);
    maxY = Math.max(maxY, interval.y);
  }
  if (!Number.isFinite(minX) || maxX - minX <= tolerance || maxY - minY <= tolerance) return [];

  const grid = Array.from({ length: INTERIOR_FILL_SCAN_ROWS }, () =>
    new Array<boolean>(INTERIOR_FILL_GRID_COLUMNS).fill(false)
  );
  const width = maxX - minX;
  for (const interval of intervals) {
    const row = interval.row;
    if (!grid[row]) continue;
    const start = Math.max(0, Math.floor(((interval.x0 - minX) / width) * INTERIOR_FILL_GRID_COLUMNS));
    const end = Math.min(
      INTERIOR_FILL_GRID_COLUMNS - 1,
      Math.ceil(((interval.x1 - minX) / width) * INTERIOR_FILL_GRID_COLUMNS) - 1,
    );
    for (let col = start; col <= end; col++) grid[row][col] = true;
  }

  const radius = Math.max(
    1,
    Math.round(Math.min(INTERIOR_FILL_SCAN_ROWS, INTERIOR_FILL_GRID_COLUMNS) * INTERIOR_FILL_OPEN_RADIUS_RATIO),
  );
  const eroded = erodeGrid(grid, radius);
  const components = largestGridComponents(eroded);
  if (components.length === 0) return [];

  const rowStep = (maxY - minY) / INTERIOR_FILL_SCAN_ROWS;
  const loops: Point2[][] = [];
  for (const component of components) {
    const opened = dilateGrid(component, radius);
    const rows = trimCavityRows(refinedGridRowsToIntervals(opened, intervals, minX, maxX, minY, maxY));
    if (rows.length < INTERIOR_FILL_MIN_INTERVAL_ROWS) continue;

    const estimatedArea = rows.reduce((sum, row) => sum + row.length * rowStep, 0);
    if (estimatedArea < candidateArea * INTERIOR_FILL_MIN_SLICE_AREA_RATIO) continue;

    const loop = [
      ...rows.map((row): Point2 => [row.x0, row.y]),
      ...rows.slice().reverse().map((row): Point2 => [row.x1, row.y]),
    ];
    const cleaned = cleanLoop2D(loop, tolerance);
    if (cleaned.length >= 3) loops.push(insetLoop2D(cleaned, tolerance));
  }
  return loops;
}

function trimCavityRows(rows: InteriorFillInterval[]): InteriorFillInterval[] {
  if (rows.length < INTERIOR_FILL_END_TRIM_MIN_ROWS) return rows;

  const maxLength = Math.max(...rows.map((row) => row.length));
  const minEndLength = maxLength * INTERIOR_FILL_END_TRIM_LENGTH_RATIO;
  let start = 0;
  let end = rows.length;
  while (end - start > INTERIOR_FILL_MIN_INTERVAL_ROWS && rows[start].length < minEndLength) {
    start += 1;
  }
  while (end - start > INTERIOR_FILL_MIN_INTERVAL_ROWS && rows[end - 1].length < minEndLength) {
    end -= 1;
  }
  const trimmed = start === 0 && end === rows.length ? rows : rows.slice(start, end);
  return trimCavityRowSides(trimmed);
}

function trimCavityRowSides(rows: InteriorFillInterval[]): InteriorFillInterval[] {
  if (rows.length < INTERIOR_FILL_END_TRIM_MIN_ROWS) return rows;

  const maxLength = Math.max(...rows.map((row) => row.length));
  const minLength = maxLength * INTERIOR_FILL_SIDE_TRIM_MIN_LENGTH_RATIO;
  return rows.map((row, index) => {
    const start = Math.max(0, index - INTERIOR_FILL_SIDE_TRIM_WINDOW);
    const end = Math.min(rows.length, index + INTERIOR_FILL_SIDE_TRIM_WINDOW + 1);
    const neighbors = rows.slice(start, end).filter((_, neighborIndex) => start + neighborIndex !== index);
    if (neighbors.length < 2) return row;

    const leftLimit = quantile(neighbors.map((neighbor) => neighbor.x0), INTERIOR_FILL_SIDE_TRIM_QUANTILE);
    const rightLimit = quantile(neighbors.map((neighbor) => neighbor.x1), 1 - INTERIOR_FILL_SIDE_TRIM_QUANTILE);
    const x0 = Math.max(row.x0, leftLimit);
    const x1 = Math.min(row.x1, rightLimit);
    const length = x1 - x0;
    if (length < minLength) return row;
    return { ...row, x0, x1, length };
  });
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * q), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

function erodeGrid(grid: boolean[][], radius: number): boolean[][] {
  return grid.map((row, y) => row.map((filled, x) => {
    if (!filled) return false;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        if (!grid[y + dy]?.[x + dx]) return false;
      }
    }
    return true;
  }));
}

function dilateGrid(grid: boolean[][], radius: number): boolean[][] {
  const out = grid.map((row) => row.map(() => false));
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!grid[y][x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > radius) continue;
          const row = out[y + dy];
          if (row && x + dx >= 0 && x + dx < row.length) row[x + dx] = true;
        }
      }
    }
  }
  return out;
}

function largestGridComponents(grid: boolean[][]): boolean[][][] {
  const seen = grid.map((row) => row.map(() => false));
  const components: Point2[][] = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!grid[y][x] || seen[y][x]) continue;
      const queue: Point2[] = [[x, y]];
      const component: Point2[] = [];
      seen[y][x] = true;
      for (let i = 0; i < queue.length; i++) {
        const [cx, cy] = queue[i];
        component.push([cx, cy]);
        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!grid[ny]?.[nx] || seen[ny][nx]) continue;
          seen[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
      components.push(component);
    }
  }

  components.sort((a, b) => b.length - a.length);
  const largest = components[0]?.length ?? 0;
  if (largest === 0) return [];
  const minSize = largest * INTERIOR_FILL_SECONDARY_COMPONENT_AREA_RATIO;
  return components
    .filter((component) => component.length >= minSize)
    .slice(0, INTERIOR_FILL_MAX_COMPONENTS_PER_SLICE)
    .map((component) => {
      const out = grid.map((row) => row.map(() => false));
      for (const [x, y] of component) out[y][x] = true;
      return out;
    });
}

function gridRowsToIntervals(
  grid: boolean[][],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): InteriorFillInterval[] {
  const rows: InteriorFillInterval[] = [];
  const width = maxX - minX;
  const height = maxY - minY;
  for (let row = 0; row < grid.length; row++) {
    let start = -1;
    let end = -1;
    for (let col = 0; col < grid[row].length; col++) {
      if (!grid[row][col]) continue;
      if (start < 0) start = col;
      end = col;
    }
    if (start < 0) continue;
    const x0 = minX + (start / INTERIOR_FILL_GRID_COLUMNS) * width;
    const x1 = minX + ((end + 1) / INTERIOR_FILL_GRID_COLUMNS) * width;
    const y = minY + ((row + 0.5) / INTERIOR_FILL_SCAN_ROWS) * height;
    rows.push({ row, y, x0, x1, length: x1 - x0 });
  }
  return rows;
}

function refinedGridRowsToIntervals(
  grid: boolean[][],
  sourceIntervals: InteriorFillInterval[],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): InteriorFillInterval[] {
  const rows = gridRowsToIntervals(grid, minX, maxX, minY, maxY);
  if (rows.length === 0) return rows;

  const byRow = new Map<number, InteriorFillInterval[]>();
  for (const interval of sourceIntervals) {
    const current = byRow.get(interval.row);
    if (current) current.push(interval);
    else byRow.set(interval.row, [interval]);
  }

  const cellWidth = (maxX - minX) / INTERIOR_FILL_GRID_COLUMNS;
  return rows.map((row) => {
    const expanded: InteriorFillInterval = {
      ...row,
      x0: row.x0 - cellWidth,
      x1: row.x1 + cellWidth,
      length: row.length + cellWidth * 2,
    };
    let best: InteriorFillInterval | null = null;
    let bestOverlap = 0;
    for (const source of byRow.get(row.row) ?? []) {
      const overlap = intervalOverlap(source, expanded);
      if (overlap > bestOverlap) {
        best = source;
        bestOverlap = overlap;
      }
    }
    if (!best || bestOverlap <= 0) return row;

    const x0 = Math.max(best.x0, expanded.x0);
    const x1 = Math.min(best.x1, expanded.x1);
    const length = x1 - x0;
    return length > 0 ? { row: row.row, y: best.y, x0, x1, length } : row;
  });
}

function orientPoint2D(point: Point2, swapAxes: boolean): Point2 {
  return swapAxes ? [point[1], point[0]] : point;
}

function scanlineIntervals(segments: Segment2[], tolerance: number): InteriorFillInterval[] {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const segment of segments) {
    minY = Math.min(minY, segment.a[1], segment.b[1]);
    maxY = Math.max(maxY, segment.a[1], segment.b[1]);
  }
  const spanY = maxY - minY;
  if (!Number.isFinite(spanY) || spanY <= tolerance) return [];

  const intervals: InteriorFillInterval[] = [];
  for (let row = 0; row < INTERIOR_FILL_SCAN_ROWS; row++) {
    const y = minY + ((row + 0.5) / INTERIOR_FILL_SCAN_ROWS) * spanY;
    const xs: number[] = [];
    for (const segment of segments) {
      const y0 = segment.a[1];
      const y1 = segment.b[1];
      const dy = y1 - y0;
      if (Math.abs(dy) <= tolerance) continue;
      const t = (y - y0) / dy;
      if (t < -tolerance || t > 1 + tolerance) continue;
      xs.push(segment.a[0] + (segment.b[0] - segment.a[0]) * t);
    }

    const sorted = uniqueNumbers(xs.sort((a, b) => a - b), tolerance);
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const x0 = sorted[i];
      const x1 = sorted[i + 1];
      const length = x1 - x0;
      if (length <= tolerance) continue;
      intervals.push({ row, y, x0, x1, length });
    }
  }
  return intervals;
}

function uniqueNumbers(values: number[], tolerance: number): number[] {
  const unique: number[] = [];
  for (const value of values) {
    if (unique.length === 0 || Math.abs(value - unique[unique.length - 1]) > tolerance) {
      unique.push(value);
    }
  }
  return unique;
}

function largestIntervalComponent(intervals: InteriorFillInterval[]): InteriorFillInterval[] {
  const parent = intervals.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number): void => {
    const ar = find(a);
    const br = find(b);
    if (ar !== br) parent[br] = ar;
  };

  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (Math.abs(intervals[i].row - intervals[j].row) > 1) continue;
      const overlap = intervalOverlap(intervals[i], intervals[j]);
      const required = Math.min(intervals[i].length, intervals[j].length) * INTERIOR_FILL_INTERVAL_OVERLAP_RATIO;
      if (overlap >= required) union(i, j);
    }
  }

  const groups = new Map<number, { intervals: InteriorFillInterval[]; score: number }>();
  for (let i = 0; i < intervals.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) {
      group.intervals.push(intervals[i]);
      group.score += intervals[i].length;
    } else {
      groups.set(root, { intervals: [intervals[i]], score: intervals[i].length });
    }
  }

  let best: { intervals: InteriorFillInterval[]; score: number } | null = null;
  for (const group of groups.values()) {
    if (!best || group.score > best.score) best = group;
  }
  return best?.intervals ?? [];
}

function intervalOverlap(a: InteriorFillInterval, b: InteriorFillInterval): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
}

function cleanLoop2D(points: Point2[], tolerance: number): Point2[] {
  const cleaned: Point2[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (distance2D(prev, current) <= tolerance || distance2D(current, next) <= tolerance) continue;
    if (Math.abs(cross2D(prev, current, next)) <= tolerance * tolerance) continue;
    cleaned.push(current);
  }
  return cleaned;
}

function insetLoop2D(points: Point2[], tolerance: number): Point2[] {
  if (points.length < 3) return points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const minSpan = Math.min(maxX - minX, maxY - minY);
  const insetDistance = clamp(
    minSpan * INTERIOR_FILL_INSET_DISTANCE_RATIO,
    tolerance * 8,
    minSpan * INTERIOR_FILL_INSET_MAX_DISTANCE_RATIO,
  );
  if (!Number.isFinite(insetDistance) || insetDistance <= tolerance) return points;

  const area = loopArea2D(points);
  const orientation = area >= 0 ? 1 : -1;
  const normals: Point2[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const dx = next[0] - current[0];
    const dy = next[1] - current[1];
    const length = Math.hypot(dx, dy);
    if (length <= tolerance) return scaleLoopTowardCentroid2D(points, insetDistance);
    normals.push([
      (-dy / length) * orientation,
      (dx / length) * orientation,
    ]);
  }

  const maxMiter = insetDistance * INTERIOR_FILL_MAX_MITER_RATIO + tolerance;
  const inset = points.map((point, index): Point2 => {
    const prevIndex = (index - 1 + points.length) % points.length;
    const nextIndex = (index + 1) % points.length;
    const prevNormal = normals[prevIndex];
    const currentNormal = normals[index];
    const prevPoint = points[prevIndex];
    const nextPoint = points[nextIndex];
    const previousLineA: Point2 = [
      prevPoint[0] + prevNormal[0] * insetDistance,
      prevPoint[1] + prevNormal[1] * insetDistance,
    ];
    const previousLineB: Point2 = [
      point[0] + prevNormal[0] * insetDistance,
      point[1] + prevNormal[1] * insetDistance,
    ];
    const currentLineA: Point2 = [
      point[0] + currentNormal[0] * insetDistance,
      point[1] + currentNormal[1] * insetDistance,
    ];
    const currentLineB: Point2 = [
      nextPoint[0] + currentNormal[0] * insetDistance,
      nextPoint[1] + currentNormal[1] * insetDistance,
    ];
    const fallback = averagedInsetPoint(point, prevNormal, currentNormal, insetDistance);
    const intersection = lineIntersection2D(previousLineA, previousLineB, currentLineA, currentLineB, tolerance);
    if (!intersection || distance2D(point, intersection) > maxMiter) return fallback;
    return intersection;
  });

  const cleaned = cleanLoop2D(inset, tolerance);
  if (cleaned.length < 3) return scaleLoopTowardCentroid2D(points, insetDistance);
  const insetArea = loopArea2D(cleaned);
  if (
    Math.sign(insetArea || area) !== Math.sign(area) ||
    Math.abs(insetArea) < Math.abs(area) * 0.05 ||
    !loopInsideLoop2D(cleaned, points, tolerance)
  ) {
    return scaleLoopTowardCentroid2D(points, insetDistance);
  }
  return cleaned;
}

function averagedInsetPoint(point: Point2, a: Point2, b: Point2, distance: number): Point2 {
  const nx = a[0] + b[0];
  const ny = a[1] + b[1];
  const length = Math.hypot(nx, ny);
  if (length <= 1e-8) return [point[0] + b[0] * distance, point[1] + b[1] * distance];
  return [
    point[0] + (nx / length) * distance,
    point[1] + (ny / length) * distance,
  ];
}

function lineIntersection2D(a0: Point2, a1: Point2, b0: Point2, b1: Point2, tolerance: number): Point2 | null {
  const rx = a1[0] - a0[0];
  const ry = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sy = b1[1] - b0[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= tolerance * tolerance) return null;

  const qpx = b0[0] - a0[0];
  const qpy = b0[1] - a0[1];
  const t = (qpx * sy - qpy * sx) / denominator;
  return [a0[0] + rx * t, a0[1] + ry * t];
}

function loopInsideLoop2D(inner: Point2[], outer: Point2[], tolerance: number): boolean {
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    const mid: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!pointInLoop2D(a, outer, tolerance) || !pointInLoop2D(mid, outer, tolerance)) return false;
  }
  return true;
}

function pointInLoop2D(point: Point2, loop: Point2[], tolerance: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (pointNearSegment2D(point, a, b, tolerance)) return true;
    const intersects = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointNearSegment2D(point: Point2, a: Point2, b: Point2, tolerance: number): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= tolerance * tolerance) return distance2D(point, a) <= tolerance;
  const t = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq, 0, 1);
  const closest: Point2 = [a[0] + dx * t, a[1] + dy * t];
  return distance2D(point, closest) <= tolerance;
}

function scaleLoopTowardCentroid2D(points: Point2[], distance: number): Point2[] {
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point[0];
    cy += point[1];
  }
  cx /= points.length;
  cy /= points.length;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy);
    if (length <= distance || length <= 1e-8) return [x, y];
    const scale = (length - distance) / length;
    return [
      cx + dx * scale,
      cy + dy * scale,
    ];
  });
}

function loopArea2D(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function totalLoopArea2D(loops: Point2[][]): number {
  return loops.reduce((sum, loop) => sum + Math.abs(loopArea2D(loop)), 0);
}

function loopCentroid2D(points: Point2[]): Point2 {
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point[0];
    cy += point[1];
  }
  return points.length > 0 ? [cx / points.length, cy / points.length] : [0, 0];
}

function cross2D(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function distance2D(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function colorLuminance(color: string | undefined): number | null {
  if (!color) return null;
  const parsed = parsePureColor(color);
  if (!parsed) return null;
  const [r, g, b] = parsed.rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(4));
}

function modelLightingStats(polygons: Polygon[]): {
  averageLuminance: number;
  colorCoverage: number;
  textureCoverage: number;
} {
  let totalWeight = 0;
  let colorWeight = 0;
  let luminanceSum = 0;
  let texturedWeight = 0;

  for (const polygon of polygons) {
    const weight = Math.max(polygonArea(polygon), 1);
    totalWeight += weight;

    const luminance = colorLuminance(polygon.color);
    if (luminance !== null) {
      colorWeight += weight;
      luminanceSum += luminance * weight;
    }

    if (polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length) {
      texturedWeight += weight;
    }
  }

  const averageLuminance = colorWeight > 0 ? luminanceSum / colorWeight : 0.55;
  const colorCoverage = totalWeight > 0 ? colorWeight / totalWeight : 0;
  const textureCoverage = totalWeight > 0 ? texturedWeight / totalWeight : 0;
  return { averageLuminance, colorCoverage, textureCoverage };
}

function smartAmbientForModel(model: PresetModel, polygons: Polygon[]): number {
  if (polygons.length === 0) return DEFAULT_SCENE.ambientIntensity;

  const { averageLuminance, colorCoverage, textureCoverage } = modelLightingStats(polygons);

  const neutralLuminance = 0.52;
  const darkness = clamp((neutralLuminance - averageLuminance) / neutralLuminance, 0, 1);
  const brightness = clamp((averageLuminance - neutralLuminance) / (1 - neutralLuminance), 0, 1);
  // Albedo is not exposure: very bright models still need fill, and dark
  // saturated models should not be washed out by aggressive compensation.
  const luminanceAdjustment =
    Math.pow(darkness, 1.35) * 0.14 -
    Math.pow(brightness, 1.4) * 0.08;
  const densityLift = clamp(Math.log10(Math.max(polygons.length, 1) / 1800), -0.8, 1.2) * 0.025;
  const textureLift = textureCoverage > 0.3 && colorCoverage < 0.75 && averageLuminance < 0.58 ? 0.04 : 0;
  const voxelLift = model.kind === "vox" ? 0.03 : 0;

  return roundToStep(
    clamp(
      DEFAULT_SCENE.ambientIntensity + luminanceAdjustment + densityLift + textureLift + voxelLift,
      0.28,
      0.65,
    ),
    0.05,
  );
}

function smartKeyIntensityForModel(polygons: Polygon[]): number {
  if (polygons.length === 0) return DEFAULT_SCENE.lightIntensity;

  const { averageLuminance } = modelLightingStats(polygons);
  const neutralLuminance = 0.52;
  const darkness = clamp((neutralLuminance - averageLuminance) / neutralLuminance, 0, 1);
  const brightness = clamp((averageLuminance - neutralLuminance) / (1 - neutralLuminance), 0, 1);
  const keyAdjustment =
    Math.pow(darkness, 1.6) * 0.04 -
    Math.pow(brightness, 1.2) * 0.12;

  return roundToStep(
    clamp(
      DEFAULT_SCENE.lightIntensity + keyAdjustment,
      0.85,
      1.05,
    ),
    0.05,
  );
}

function smartZoomForPolygons(polygons: Polygon[]): number {
  if (polygons.length === 0) return 0.35;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const maxSpan = Math.max(spanX, spanY, spanZ);
  if (!Number.isFinite(maxSpan) || maxSpan <= 0) return 0.35;
  const spanRatio = clamp(maxSpan / 110, 0.06, 7);
  const zoom = 1.2 / Math.sqrt(spanRatio);
  return clamp(zoom, 0.06, 0.82);
}

function defaultZoomForModel(model: PresetModel, polygons: Polygon[]): number {
  const presetZoom = model.zoom ?? DEFAULT_SCENE.zoom;
  const smartZoom = smartZoomForPolygons(polygons);
  return clamp((presetZoom * 0.85 + smartZoom * 0.15) * 0.55, 0.08, 1.2);
}

function mergeParserOptions(
  base: ObjParseOptions | GltfParseOptions | VoxParseOptions | undefined,
  parser: ParserOptionsState,
): ObjParseOptions & GltfParseOptions & VoxParseOptions {
  return {
    ...(base ?? {}),
    targetSize: parser.targetSize,
    gridShift: parser.gridShift,
    defaultColor: parser.defaultColor,
  };
}

async function loadPresetModel(model: PresetModel, parser: ParserOptionsState): Promise<LoadedModel> {
  const started = performance.now();
  if (model.kind === "obj") {
    const [objText, mtlText] = await Promise.all([
      fetch(model.url).then((res) => {
        if (!res.ok) throw new Error(`fetch ${model.url} -> ${res.status}`);
        return res.text();
      }),
      model.mtlUrl
        ? fetch(model.mtlUrl).then((res) => (res.ok ? res.text() : null))
        : Promise.resolve(null),
    ]);

    const mtl = mtlText ? parseMtl(mtlText) : { colors: {}, textures: {} };
    const resolvedTextures: Record<string, string> = {};
    for (const [name, path] of Object.entries(mtl.textures)) {
      resolvedTextures[name] = model.mtlUrl
        ? new URL(path, new URL(model.mtlUrl, window.location.href)).href
        : path;
    }

    const options = mergeParserOptions(model.options, parser);
    const parsedObj = parseObj(objText, {
      ...options,
      materialColors: {
        ...mtl.colors,
        ...((model.options as ObjParseOptions | undefined)?.materialColors ?? {}),
      },
      materialTextures: {
        ...resolvedTextures,
        ...((model.options as ObjParseOptions | undefined)?.materialTextures ?? {}),
      },
    });
    const parsed = await bakeSolidTextureSamples(parsedObj);
    const finalPolys = optimizeMeshPolygons(parsed.polygons, { meshResolution: "lossless" });
    return {
      label: model.label,
      kind: "obj",
      rawPolygons: parsed.polygons,
      polygons: finalPolys,
      sourcePolygons: parsed.polygons.length,
      sourceBytes: objText.length + (mtlText?.length ?? 0),
      warnings: parsed.warnings ?? [],
      parseMs: performance.now() - started,
      dispose: parsed.dispose,
    };
  }

  const buf = await fetch(model.url).then((res) => {
    if (!res.ok) throw new Error(`fetch ${model.url} -> ${res.status}`);
    return res.arrayBuffer();
  });

  if (model.kind === "vox") {
    const parsed = parseVox(buf, mergeParserOptions(model.options, parser));
    const finalPolys = optimizeMeshPolygons(parsed.polygons, { meshResolution: "lossless" });
    return {
      label: model.label,
      kind: "vox",
      rawPolygons: parsed.polygons,
      polygons: finalPolys,
      sourcePolygons: parsed.polygons.length,
      sourceBytes: buf.byteLength,
      warnings: parsed.warnings ?? [],
      parseMs: performance.now() - started,
      dispose: parsed.dispose,
    };
  }

  const parsedGltf = parseGltf(buf, {
    ...mergeParserOptions(model.options, parser),
    baseUrl: new URL(model.url, window.location.href).href,
  });
  const parsed = await bakeSolidTextureSamples(parsedGltf);
  const finalPolys = optimizeMeshPolygons(parsed.polygons, { meshResolution: "lossless" });
  return {
    label: model.label,
    kind: model.kind,
    rawPolygons: parsed.polygons,
    polygons: finalPolys,
    sourcePolygons: parsed.polygons.length,
    sourceBytes: buf.byteLength,
    warnings: parsed.warnings ?? [],
    parseMs: performance.now() - started,
    dispose: parsed.dispose,
    animation: parsed.animation,
  };
}

async function loadDroppedModel(source: DroppedModelSource, parser: ParserOptionsState): Promise<LoadedModel> {
  const started = performance.now();
  const options = mergeParserOptions(source.preset.options, parser);
  const sourceBytes = source.files.reduce((sum, file) => sum + file.size, 0);

  if (source.kind === "obj") {
    const objText = await source.primaryFile.text();
    const index = buildDroppedFileIndex(source.files);
    const mtllibRefs = extractObjMtllibRefs(objText);
    const mtlFiles = findDroppedMtlFiles(objText, source.files, index);
    const warnings: string[] = [];
    const objectUrls: string[] = [];

    if (mtllibRefs.length > 0 && mtlFiles.length === 0) {
      warnings.push(`OBJ references ${mtllibRefs.join(", ")} but no matching .mtl file was dropped.`);
    }

    const materialColors: Record<string, string> = {};
    const materialTextures: Record<string, string> = {};
    for (const mtlFile of mtlFiles) {
      const mtl = parseMtl(await mtlFile.text());
      Object.assign(materialColors, mtl.colors);
      for (const [materialName, texturePath] of Object.entries(mtl.textures)) {
        const textureFile = findDroppedFile(index, texturePath);
        if (!textureFile) {
          warnings.push(`MTL texture "${texturePath}" was not dropped.`);
          continue;
        }
        if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
          warnings.push(`MTL texture "${texturePath}" cannot be loaded because object URLs are unavailable.`);
          continue;
        }
        const textureUrl = URL.createObjectURL(textureFile);
        objectUrls.push(textureUrl);
        materialTextures[materialName] = textureUrl;
      }
    }

    const presetOptions = source.preset.options as ObjParseOptions | undefined;
    const parsedObj = parseObj(objText, {
      ...options,
      materialColors: {
        ...materialColors,
        ...(presetOptions?.materialColors ?? {}),
      },
      materialTextures: {
        ...materialTextures,
        ...(presetOptions?.materialTextures ?? {}),
      },
    });
    const parsed = await bakeSolidTextureSamples(parsedObj);
    const finalPolys = optimizeMeshPolygons(parsed.polygons, { meshResolution: "lossless" });
    let disposed = false;
    return {
      label: source.label,
      kind: "obj",
      rawPolygons: parsed.polygons,
      polygons: finalPolys,
      sourcePolygons: parsed.polygons.length,
      sourceBytes,
      warnings: [...(parsed.warnings ?? []), ...warnings],
      parseMs: performance.now() - started,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        parsed.dispose();
        for (const url of objectUrls) URL.revokeObjectURL(url);
      },
    };
  }

  const buf = await source.primaryFile.arrayBuffer();

  if (source.kind === "vox") {
    const parsed = parseVox(buf, options);
    const finalPolys = optimizeMeshPolygons(parsed.polygons, { meshResolution: "lossless" });
    return {
      label: source.label,
      kind: "vox",
      rawPolygons: parsed.polygons,
      polygons: finalPolys,
      sourcePolygons: parsed.polygons.length,
      sourceBytes,
      warnings: parsed.warnings ?? [],
      parseMs: performance.now() - started,
      dispose: parsed.dispose,
    };
  }

  const parsedGltf = parseGltf(buf, options);
  const parsed = await bakeSolidTextureSamples(parsedGltf);
  const finalPolys = optimizeMeshPolygons(parsed.polygons, { meshResolution: "lossless" });
  return {
    label: source.label,
    kind: "glb",
    rawPolygons: parsed.polygons,
    polygons: finalPolys,
    sourcePolygons: parsed.polygons.length,
    sourceBytes,
    warnings: parsed.warnings ?? [],
    parseMs: performance.now() - started,
    dispose: parsed.dispose,
    animation: parsed.animation,
  };
}

function buildFloor(polygons: Polygon[]): Polygon | null {
  if (polygons.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const padX = Math.max(2, (maxX - minX) * 0.18);
  const padY = Math.max(2, (maxY - minY) * 0.18);
  return {
    vertices: [
      [minX - padX, minY - padY, 0],
      [maxX + padX, minY - padY, 0],
      [maxX + padX, maxY + padY, 0],
      [minX - padX, maxY + padY, 0],
    ],
    color: "#252a2d",
  };
}

function directionalFromOptions(options: SceneOptionsState): PolyDirectionalLight {
  const az = (options.lightAzimuth * Math.PI) / 180;
  const el = (options.lightElevation * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return {
    direction: [
      cosEl * Math.sin(az),
      cosEl * Math.cos(az),
      Math.sin(el),
    ],
    color: options.lightColor,
    intensity: options.lightIntensity,
  };
}

function ambientFromOptions(options: SceneOptionsState): PolyAmbientLight {
  return {
    color: options.ambientColor,
    intensity: options.ambientIntensity,
  };
}

function cssColorAlpha(value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "transparent") return 0;
  const parsed = parsePureColor(trimmed);
  if (parsed) return parsed.alpha;
  const slashAlpha = trimmed.match(/\/\s*([\d.]+%?)\s*\)?$/);
  if (!slashAlpha) return null;
  const raw = slashAlpha[1];
  const valueAsNumber = raw.endsWith("%")
    ? Number(raw.slice(0, -1)) / 100
    : Number(raw);
  return Number.isFinite(valueAsNumber) ? clamp(valueAsNumber, 0, 1) : null;
}

function inlineStyleValue(element: HTMLElement, property: string): string | null {
  const styleAttr = element.getAttribute("style") ?? "";
  return getInlineStyleDeclaration(styleAttr, property)
    ?? element.style.getPropertyValue(property).trim()
    ?? null;
}

function resolvedStyleValue(element: HTMLElement, property: string): string | null {
  const inline = inlineStyleValue(element, property);
  if (inline) return inline;
  const view = element.ownerDocument.defaultView;
  return view?.getComputedStyle(element).getPropertyValue(property).trim() ?? null;
}

function cssPxValue(value: string | null | undefined): number | null {
  const match = value?.trim().match(/^(-?\d*\.?\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function cssNumberValue(value: string | null | undefined): number | null {
  const parsed = Number.parseFloat(value?.trim() ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function cssUrlValue(value: string | null | undefined): string | null {
  const match = value?.match(/url\((?:"([^"]+)"|'([^']+)'|([^)]*?))\)/i);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "none") return null;
  return trimmed;
}

function cssPaintAlpha(element: HTMLElement, properties: string[]): number {
  for (const property of properties) {
    const alpha = cssColorAlpha(resolvedStyleValue(element, property));
    if (alpha !== null) return alpha;
  }
  return 1;
}

function localElementSize(element: HTMLElement): { width: number; height: number } {
  if (element.tagName === "U") {
    const left = cssPxValue(resolvedStyleValue(element, "border-left-width")) ?? 0;
    const right = cssPxValue(resolvedStyleValue(element, "border-right-width")) ?? 0;
    const bottom = cssPxValue(resolvedStyleValue(element, "border-bottom-width")) ?? 0;
    return {
      width: Math.max(1, left + right),
      height: Math.max(1, bottom),
    };
  }

  return {
    width: Math.max(1, cssPxValue(resolvedStyleValue(element, "width")) ?? element.offsetWidth),
    height: Math.max(1, cssPxValue(resolvedStyleValue(element, "height")) ?? element.offsetHeight),
  };
}

function loadAlphaImage(url: string): Promise<HTMLImageElement> {
  let promise = SPRITE_ALPHA_IMAGE_CACHE.get(url);
  if (promise) return promise;

  promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`alpha image load failed: ${url}`));
    img.src = url;
  });
  SPRITE_ALPHA_IMAGE_CACHE.set(url, promise);
  return promise;
}

function emitOverpaintCacheUpdate(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DOM_OVERPAINT_CACHE_EVENT));
}

async function sampleSpriteAlpha(
  key: string,
  url: string,
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
  cssBackgroundW: number,
  cssBackgroundH: number,
): Promise<void> {
  try {
    const img = await loadAlphaImage(url);
    const scaleX = img.naturalWidth / cssBackgroundW;
    const scaleY = img.naturalHeight / cssBackgroundH;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return;

    const sx = Math.max(0, Math.round(cssX * scaleX));
    const sy = Math.max(0, Math.round(cssY * scaleY));
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(cssW * scaleX)));
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(cssH * scaleY)));
    if (sw <= 0 || sh <= 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const pixels = ctx.getImageData(0, 0, sw, sh).data;
    let alpha = 0;
    for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i] / 255;
    SPRITE_ALPHA_CACHE.set(key, alpha / (pixels.length / 4));
  } catch {
    SPRITE_ALPHA_CACHE.set(key, 1);
  } finally {
    SPRITE_ALPHA_PENDING.delete(key);
    emitOverpaintCacheUpdate();
  }
}

function spriteAtlasAlpha(element: HTMLElement): number | null {
  const view = element.ownerDocument.defaultView;
  if (!view || typeof Image === "undefined") return null;

  const style = view.getComputedStyle(element);
  const url = cssUrlValue(style.backgroundImage)
    ?? cssUrlValue(style.getPropertyValue("-webkit-mask-image"))
    ?? cssUrlValue(style.getPropertyValue("mask-image"))
    ?? cssUrlValue(style.background);
  if (!url) return null;

  const width = cssPxValue(style.width) ?? element.offsetWidth;
  const height = cssPxValue(style.height) ?? element.offsetHeight;
  const positionX = cssNumberValue(style.backgroundPositionX) ?? 0;
  const positionY = cssNumberValue(style.backgroundPositionY) ?? 0;
  const maskPosition = style.getPropertyValue("-webkit-mask-position") || style.getPropertyValue("mask-position");
  const [maskPositionXRaw, maskPositionYRaw] = maskPosition.split(/\s+/);
  const cssX = -(cssNumberValue(style.backgroundPositionX) ?? cssNumberValue(maskPositionXRaw) ?? positionX);
  const cssY = -(cssNumberValue(style.backgroundPositionY) ?? cssNumberValue(maskPositionYRaw) ?? positionY);
  const size = style.backgroundSize || style.getPropertyValue("-webkit-mask-size") || style.getPropertyValue("mask-size");
  const [backgroundWidthRaw, backgroundHeightRaw] = size.split(/\s+/);
  const backgroundWidth = cssPxValue(backgroundWidthRaw);
  const backgroundHeight = cssPxValue(backgroundHeightRaw);
  if (!width || !height || !backgroundWidth || !backgroundHeight) return null;

  const key = [
    url,
    cssX.toFixed(3),
    cssY.toFixed(3),
    width.toFixed(3),
    height.toFixed(3),
    backgroundWidth.toFixed(3),
    backgroundHeight.toFixed(3),
  ].join("|");

  const cached = SPRITE_ALPHA_CACHE.get(key);
  if (cached !== undefined) return cached;

  if (!SPRITE_ALPHA_PENDING.has(key)) {
    SPRITE_ALPHA_PENDING.add(key);
    void sampleSpriteAlpha(key, url, cssX, cssY, width, height, backgroundWidth, backgroundHeight);
  }

  return null;
}

function elementPaintAlphaSample(element: HTMLElement): { alpha: number; area: number } | null {
  const { width, height } = localElementSize(element);
  const area = Math.max(1, width * height);

  if (element.tagName === "U") {
    return {
      alpha: 0.5 * cssPaintAlpha(element, ["border-bottom-color", "color", "--polycss-paint"]),
      area,
    };
  }

  if (element.tagName === "I") {
    return {
      alpha: cssPaintAlpha(element, ["border-bottom-color", "border-color", "color", "--polycss-paint"]),
      area,
    };
  }

  if (element.tagName === "S") {
    const alpha = spriteAtlasAlpha(element)
      ?? cssPaintAlpha(element, ["background-color", "background"]);
    return { alpha, area };
  }

  if (element.tagName === "B") {
    return {
      alpha: cssPaintAlpha(element, ["background-color", "background", "color", "--polycss-paint"]),
      area,
    };
  }

  return null;
}

function measureDomOverpaintPercent(scopes: HTMLElement[]): number {
  let weightedPaintAlpha = 0;
  let totalArea = 0;

  for (const scope of scopes) {
    const elements = scope.querySelectorAll<HTMLElement>("b, u, s, i");
    for (const element of elements) {
      const sample = elementPaintAlphaSample(element);
      if (!sample) continue;
      weightedPaintAlpha += clamp(sample.alpha, 0, 1) * sample.area;
      totalArea += sample.area;
    }
  }

  return totalArea > 0 ? Number(((1 - weightedPaintAlpha / totalArea) * 100).toFixed(1)) : 0;
}

function measureDom(root: HTMLElement | null): DomMetrics {
  if (!root) return EMPTY_METRICS;
  const modelScopes = Array.from(root.querySelectorAll<HTMLElement>(".dn-model-mesh"));
  if (modelScopes.length === 0) return EMPTY_METRICS;
  const scopes = modelScopes;
  const countInScopes = (selector: string): number =>
    scopes.reduce((sum, scope) => sum + scope.querySelectorAll(selector).length, 0);
  const nodeCount = scopes.reduce((sum, scope) => sum + 1 + scope.querySelectorAll("*").length, 0);

  return {
    measuredAt: performance.now(),
    nodeCount,
    sprites: countInScopes("s"),
    rects: countInScopes("b"),
    triangles: countInScopes("u"),
    irregular: countInScopes("i"),
    overpaintPercent: measureDomOverpaintPercent(scopes),
  };
}

function roundMatrix3dValue(value: string, decimals: number): string {
  return value.replace(/matrix3d\(([^)]+)\)/g, (_match, body: string) => {
    const rounded = body.split(",").map((raw) => {
      const trimmed = raw.trim();
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return trimmed;
      const next = value.toFixed(decimals).replace(/\.?0+$/, "");
      return Object.is(Number(next), -0) ? "0" : next;
    });
    return `matrix3d(${rounded.join(",")})`;
  });
}

function debugPrecisionDecimals(
  precision: MatrixPrecision | BorderShapePrecision,
): number | null {
  if (precision === "exact") return null;
  return Number(precision);
}

function roundDecimalString(value: string, decimals: number): string {
  const next = Number(value).toFixed(decimals).replace(/\.?0+$/, "");
  return Object.is(Number(next), -0) ? "0" : next;
}

function solidColorToHex(value: string): string | null {
  const parsed = parsePureColor(value);
  if (!parsed || parsed.alpha < 1) return null;
  const hex = parsed.rgb
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

function replaceSolidRgbWithHex(value: string): string {
  return value.replace(/rgba?\([^)]*\)/gi, (match) => solidColorToHex(match) ?? match);
}

function applyDebugSolidColorHex(root: HTMLElement | null): void {
  if (!root) return;
  const elements = root.querySelectorAll<HTMLElement>(".polycss-mesh, .polycss-scene b, .polycss-scene i, .polycss-scene u");
  for (const element of elements) {
    const current = element.getAttribute("style");
    if (!current || !/rgba?\(/i.test(current)) continue;
    const next = replaceSolidRgbWithHex(current);
    if (next !== current) element.setAttribute("style", next);
  }
}

function compactStyleValue(value: string): string {
  return value.replace(/matrix3d\(([^)]*)\)/gi, (_match, body: string) =>
    `matrix3d(${body.split(",").map((token) => token.trim()).join(",")})`
  );
}

function minifyInlineStyle(value: string): string {
  return compactStyleValue(value)
    .trim()
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*;\s*/g, ";");
}

const BRUSH_INLINE_STYLE_ORDER = new Map([
  ["transform", 0],
  ["border-shape", 1],
  ["border-width", 2],
  ["width", 3],
  ["height", 4],
  ["color", 5],
]);

function orderBrushInlineStyle(value: string): string {
  const declarations = value.split(";").map((declaration) => declaration.trim()).filter(Boolean);
  return declarations
    .map((declaration, index) => {
      const property = declaration.slice(0, declaration.indexOf(":")).trim().toLowerCase();
      return {
        declaration,
        index,
        order: BRUSH_INLINE_STYLE_ORDER.get(property) ?? Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ declaration }) => declaration)
    .join(";");
}

function applyDebugInlineStyleOrder(root: HTMLElement | null): void {
  if (!root) return;
  const elements = root.querySelectorAll<HTMLElement>(".polycss-scene b, .polycss-scene i, .polycss-scene s, .polycss-scene u");
  for (const element of elements) {
    const current = element.getAttribute("style");
    if (!current) continue;
    const next = orderBrushInlineStyle(current);
    if (next !== current) element.setAttribute("style", next);
  }
}

function applyDebugInlineStyleMinify(root: HTMLElement | null): void {
  if (!root) return;
  const elements = root.querySelectorAll<HTMLElement>(".polycss-mesh, .polycss-scene b, .polycss-scene i, .polycss-scene s, .polycss-scene u");
  for (const element of elements) {
    const current = element.getAttribute("style");
    if (!current) continue;
    const next = minifyInlineStyle(current);
    if (next !== current) element.setAttribute("style", next);
  }
}

function applyDebugMatrixPrecision(root: HTMLElement | null, precision: MatrixPrecision): void {
  if (!root) return;
  const decimals = debugPrecisionDecimals(precision);
  if (decimals === null) return;
  const faces = root.querySelectorAll<HTMLElement>(".polycss-scene i, .polycss-scene b, .polycss-scene s, .polycss-scene u");
  for (const face of faces) {
    const current = face.style.transform;
    if (!current.includes("matrix3d(")) continue;
    const rounded = roundMatrix3dValue(current, decimals);
    if (current !== rounded) face.style.transform = rounded;
  }
}

function applyDebugBorderShapePrecision(root: HTMLElement | null, precision: BorderShapePrecision): void {
  if (!root) return;
  const decimals = debugPrecisionDecimals(precision);
  if (decimals === null) return;
  const faces = root.querySelectorAll<HTMLElement>(".polycss-scene i");
  for (const face of faces) {
    const current = face.style.getPropertyValue("border-shape");
    if (!current.includes("polygon(")) continue;
    const rounded = current.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (match, offset, source) => {
      const prev = offset > 0 ? source[offset - 1] : "";
      const next = offset + match.length < source.length ? source[offset + match.length] : "";
      const unitContext = prev === "(" || prev === "," || /\s/.test(prev) || prev === "-" || prev === "+";
      const unitSuffix = next === "%" || /[a-z]/i.test(next);
      if (!unitContext || !unitSuffix) return match;
      return roundDecimalString(match, decimals);
    });
    if (current !== rounded) face.style.setProperty("border-shape", rounded);
  }
}

function roundTriangleBorderWidthToken(token: string, decimals: number): string {
  const trimmed = token.trim();
  const match = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]*)$/i);
  if (!match) return trimmed;

  const unit = match[2] ?? "";
  if (unit && unit.toLowerCase() !== "px") return trimmed;

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return trimmed;
  if (numeric === 0 || Object.is(numeric, -0)) return "0";

  const rounded = roundDecimalString(match[1], decimals);
  return Number(rounded) === 0 || Object.is(Number(rounded), -0)
    ? "0"
    : `${rounded}${unit || "px"}`;
}

function roundTriangleBorderWidth(value: string, decimals: number): string {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return value;
  return tokens.map((token) => roundTriangleBorderWidthToken(token, decimals)).join(" ");
}

function getInlineStyleDeclaration(styleAttr: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styleAttr.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]*)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function setInlineStyleDeclaration(face: HTMLElement, property: string, value: string): void {
  const current = face.getAttribute("style") ?? "";
  const declaration = `${property}:${value}`;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|;)\\s*${escaped}\\s*:[^;]*`, "i");
  const next = pattern.test(current)
    ? current.replace(pattern, (_match, prefix: string) => `${prefix}${declaration}`)
    : `${current}${current.trim() && !current.trim().endsWith(";") ? ";" : ""}${declaration}`;
  if (next !== current) face.setAttribute("style", next);
}

function applyDebugTriangleBrushPrecision(root: HTMLElement | null): void {
  if (!root) return;
  const decimals = 1;
  const faces = root.querySelectorAll<HTMLElement>(".polycss-scene u");
  for (const face of faces) {
    const styleAttr = face.getAttribute("style") ?? "";
    const current = getInlineStyleDeclaration(styleAttr, "border-width")
      ?? face.style.getPropertyValue("border-width").trim();
    if (!current) continue;
    const rounded = roundTriangleBorderWidth(current, decimals);
    if (current !== rounded) {
      setInlineStyleDeclaration(face, "border-width", rounded);
    }
  }
}

// Light helper world units → CSS pixels conversion (matches the helper
// components in @layoutit/polycss-react and @layoutit/polycss-vue).
const LIGHT_HELPER_TILE = 50;

function lightHelperPosition(
  light: PolyDirectionalLight,
  target: Vec3,
  distance: number,
): Vec3 {
  const [dx, dy, dz] = light.direction;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [
    (target[1] + (dx / len) * distance) * LIGHT_HELPER_TILE,
    (target[0] + (dy / len) * distance) * LIGHT_HELPER_TILE,
    (target[2] + (dz / len) * distance) * LIGHT_HELPER_TILE,
  ];
}

function VanillaScene({
  polygons,
  options,
  directionalLight,
  ambientLight,
  showAxes,
  showLight,
  showGround,
  helperScale,
  helperTarget,
  mergePolygonsForMesh,
  stableDomForMesh,
  animationKey,
  animationFrameFactory,
  onBuild,
  onCameraChange,
  enableSelection,
  meshId,
  onSelectionChange,
  gizmoMode,
  enableHover,
  onHoverChange,
  onMeshHandleChange,
}: {
  polygons: Polygon[];
  options: SceneOptionsState;
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  showAxes: boolean;
  showLight: boolean;
  showGround: boolean;
  helperScale: number;
  helperTarget: Vec3;
  mergePolygonsForMesh: boolean;
  stableDomForMesh: boolean;
  animationKey?: string;
  animationFrameFactory?: (timeSeconds: number) => Polygon[];
  onBuild: (ms: number) => void;
  onCameraChange?: (camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 }) => void;
  enableSelection?: boolean;
  meshId?: string;
  onSelectionChange?: (selectedIds: string[]) => void;
  gizmoMode?: GizmoMode;
  enableHover?: boolean;
  onHoverChange?: (id: string | null) => void;
  onMeshHandleChange?: (handle: VanillaPolyMeshHandle | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PolySceneHandle | null>(null);
  const controlsRef = useRef<PolyControlsHandle | null>(null);
  const meshHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const axesHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const lightHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const groundHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const selectionRef = useRef<PolySelectionHandle | null>(null);
  const transformControlsRef = useRef<PolyTransformControlsHandle | null>(null);
  const onBuildRef = useRef(onBuild);
  onBuildRef.current = onBuild;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onHoverChangeRef = useRef(onHoverChange);
  onHoverChangeRef.current = onHoverChange;
  const onMeshHandleChangeRef = useRef(onMeshHandleChange);
  onMeshHandleChangeRef.current = onMeshHandleChange;
  const animationPausedRef = useRef(options.animationPaused);
  animationPausedRef.current = options.animationPaused;
  const animationTimeScaleRef = useRef(options.animationTimeScale);
  animationTimeScaleRef.current = options.animationTimeScale;

  // Split things into "structural" (require destroying the scene) vs
  // "incremental" (can be applied via setOptions / setTransform). In
  // dynamic mode the chicken's atlas is light-independent, so we drop the
  // light from the structural deps — sliding the light then only flows
  // through the cheap setOptions effect, no flicker.
  const stableDirectionalForRebuild =
    options.textureLighting === "dynamic" ? null : directionalLight;
  const stableAmbientForRebuild =
    options.textureLighting === "dynamic" ? null : ambientLight;

  // Effect 1 — heavy: create the scene + add the current polygons once.
  // Polygon replacement is handled by Effect 1.5 so animation frames do not
  // tear down controls/helpers.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const sceneOptions: PolySceneOptions = {
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
      perspective: options.perspective,
      autoCenter: options.autoCenter,
      textureQuality: options.textureQuality,
      strategies: { disable: options.disableStrategies },
      experimentalTextureEdgeRepair: options.experimentalTextureEdgeRepair,
    };
    const scene = createPolyScene(host, sceneOptions);
    sceneRef.current = scene;
    meshHandleRef.current = scene.add({
      polygons,
      objectUrls: [],
      warnings: [],
      dispose: () => {},
    }, { merge: mergePolygonsForMesh, stableDom: stableDomForMesh, id: meshId, castShadow: options.castShadow });
    meshHandleRef.current.element.classList.add("dn-model-mesh");
    onMeshHandleChangeRef.current?.(meshHandleRef.current);
    return () => {
      // Tear controls down BEFORE destroying the scene — otherwise the
      // controls' rAF tick could fire one more time against a stale handle.
      onMeshHandleChangeRef.current?.(null);
      controlsRef.current?.destroy();
      controlsRef.current = null;
      axesHandleRef.current = null;
      lightHandleRef.current = null;
      groundHandleRef.current = null;
      meshHandleRef.current = null;
      sceneRef.current = null;
      scene.destroy();
    };
  }, [
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
  ]);

  // Effect 1.5 — replace geometry on the existing mesh. This is the path
  // used by animated GLB playback.
  useEffect(() => {
    const handle = meshHandleRef.current;
    if (!handle) return;
    const started = performance.now();
    handle.setPolygons(polygons, {
      merge: mergePolygonsForMesh,
      stableDom: stableDomForMesh,
    });
    requestAnimationFrame(() =>
      onBuildRef.current(performance.now() - started),
    );
  }, [polygons, mergePolygonsForMesh, stableDomForMesh]);

  // Effect 1.6 — live-toggle castShadow without rebuilding the scene.
  useEffect(() => {
    const handle = meshHandleRef.current;
    if (!handle) return;
    handle.setTransform({ castShadow: options.castShadow });
  }, [options.castShadow]);

  // Selection + transform-controls layer. Selection toggle controls
  // both — when on, clicking the mesh selects it (and attaches the
  // gizmo); clicking again deselects (and detaches). The gizmo's
  // mode follows `gizmoMode` (translate / rotate).
  useEffect(() => {
    if (!enableSelection) {
      selectionRef.current?.destroy();
      selectionRef.current = null;
      transformControlsRef.current?.destroy();
      transformControlsRef.current = null;
      onSelectionChangeRef.current?.([]);
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    const tc = createTransformControls(scene, {
      mode: gizmoMode ?? "translate",
    });
    transformControlsRef.current = tc;
    const select = createSelect(scene, {
      clearOnMiss: false,
      onChange: (meshes) => {
        // Drive the gizmo from selection: attach to the first selected
        // mesh, or detach when nothing is selected.
        tc.attach(meshes[0] ?? null);
        onSelectionChangeRef.current?.(meshes.map((m) => m.id ?? ""));
      },
    });
    selectionRef.current = select;
    return () => {
      select.destroy();
      tc.destroy();
      selectionRef.current = null;
      transformControlsRef.current = null;
    };
  }, [
    enableSelection,
    // Same deps as the scene-init effect so the selection rebinds to
    // the new PolySceneHandle whenever the scene tears down + rebuilds.
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
  ]);

  // Forward gizmo mode changes to the live PolyTransformControls handle.
  useEffect(() => {
    transformControlsRef.current?.setMode(gizmoMode ?? "translate");
  }, [gizmoMode]);

  // Hover layer for vanilla — pointerenter / pointerleave on the mesh
  // wrapper. DOM enter/leave semantics fire only when the pointer
  // actually crosses the wrapper boundary (not on every internal
  // polygon-to-polygon transition), so the hover state stays stable
  // across the chicken's many `<i>` polygons. Adds the `is-hovered`
  // class so the same `.polycss-mesh.is-hovered i { filter: brightness }`
  // rule the React path uses kicks in here too.
  useEffect(() => {
    const mesh = meshHandleRef.current;
    if (!mesh || !enableHover) {
      onHoverChangeRef.current?.(null);
      return;
    }
    const onEnter = (): void => {
      mesh.element.classList.add("is-hovered");
      onHoverChangeRef.current?.(mesh.id ?? null);
    };
    const onLeave = (): void => {
      mesh.element.classList.remove("is-hovered");
      onHoverChangeRef.current?.(null);
    };
    mesh.element.addEventListener("pointerenter", onEnter);
    mesh.element.addEventListener("pointerleave", onLeave);
    return () => {
      mesh.element.removeEventListener("pointerenter", onEnter);
      mesh.element.removeEventListener("pointerleave", onLeave);
      mesh.element.classList.remove("is-hovered");
    };
  }, [
    enableHover,
    // Same deps as the scene-init effect so the hover listener
    // reattaches to the new mesh wrapper after a scene rebuild.
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
  ]);

  useEffect(() => {
    if (!animationFrameFactory || !animationKey) return;
    let raf = 0;
    let last = performance.now();
    let elapsedSeconds = 0;
    let sampledSeconds: number | null = null;

    const tick = (now: number) => {
      const deltaSeconds = Math.max(0, (now - last) / 1000);
      last = now;
      if (!animationPausedRef.current) {
        elapsedSeconds += deltaSeconds * animationTimeScaleRef.current;
      }
      const handle = meshHandleRef.current;
      if (handle && sampledSeconds !== elapsedSeconds) {
        sampledSeconds = elapsedSeconds;
        handle.setPolygons(animationFrameFactory(elapsedSeconds), {
          merge: false,
          stableDom: true,
          recomputeAutoCenter: false,
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animationKey, animationFrameFactory]);

  // Effect 2 — cheap: live transform + lighting updates via setOptions.
  // Sliding sliders only flows through this path.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      target: options.target as Vec3,
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
    });
  }, [
    options.rotX,
    options.rotY,
    options.zoom,
    options.target,
    options.textureLighting,
    directionalLight,
    ambientLight,
  ]);

  // Effect 2b — strategy toggles. Kept separate from Effect 2 because
  // `setOptions({ strategies })` triggers a full mesh re-render in
  // createPolyScene; folding it into the camera/lighting effect would
  // re-render on every rotation/zoom tick.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({
      strategies: { disable: options.disableStrategies },
    });
  }, [options.disableStrategies]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({
      experimentalTextureEdgeRepair: options.experimentalTextureEdgeRepair,
    });
  }, [options.experimentalTextureEdgeRepair]);

  // Effect 2.5 — vanilla controls. The React renderer wires interactive +
  // animate through <PolyCamera>; the vanilla path uses createPolyOrbitControls.
  // The handle is created lazily once the scene is ready and we're on the
  // vanilla renderer; subsequent prop changes flow through controls.update().
  useEffect(() => {
    if (options.renderer !== "vanilla") {
      controlsRef.current?.destroy();
      controlsRef.current = null;
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    const controlsOpts = {
      drag: options.interactive,
      wheel: options.interactive,
      animate: options.animate ? { speed: 0.3, axis: "y" as const, pauseOnInteraction: true } : false as const,
    };
    if (!controlsRef.current) {
      const factory = options.dragMode === "pan" ? createPolyMapControls : createPolyOrbitControls;
      const controls: PolyControlsHandle = factory(scene, controlsOpts);
      controls.addEventListener("end", ((e: { camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 } }) => {
        onCameraChangeRef.current?.(e.camera);
      }) as any);
      controlsRef.current = controls;
    } else {
      // dragMode is a dep — when it changes, destroy and re-create with the
      // new factory so orbit vs pan semantics flip correctly.
      controlsRef.current.destroy();
      const factory = options.dragMode === "pan" ? createPolyMapControls : createPolyOrbitControls;
      const controls: PolyControlsHandle = factory(scene, controlsOpts);
      controls.addEventListener("end", ((e: { camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 } }) => {
        onCameraChangeRef.current?.(e.camera);
      }) as any);
      controlsRef.current = controls;
    }
    return () => {
      // Effect re-runs when deps change — destroy only on full unmount,
      // which is signaled by the scene Effect 1 cleanup destroying scene.
      // Until then, the next effect run will reuse + update controlsRef.
    };
  }, [
    options.renderer,
    options.interactive,
    options.animate,
    options.dragMode,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
  ]);

  // Effect 3 — axes helper. Add/remove based on toggle; rebuild when scale
  // changes (different bar lengths bake into different polygons).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showAxes) {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
      return;
    }
    axesHandleRef.current = scene.add(
      {
        polygons: axesHelperPolygons({ size: helperScale * 0.6 }),
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      { excludeFromAutoCenter: true },
    );
    return () => {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
    };
  }, [
    showAxes,
    helperScale,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
  ]);

  // Effect 3.5 — ground receiver. A flat quad in the XY plane (Z is "up"
  // in polycss's world convention — the red-green plane in the axes helper
  // is the floor) at the model's min-Z, sized to ~3× the model's horizontal
  // span. Gives shadows something to land on. excludeFromAutoCenter so
  // toggling it doesn't shift the camera pivot; castShadow:false because
  // the floor doesn't shadow itself.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showGround || polygons.length === 0) {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
      return;
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of polygons) {
      for (const v of p.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    if (!Number.isFinite(minZ)) {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
      return;
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const pad = span * 1.5;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const z = minZ;
    const groundPoly: Polygon = {
      vertices: [
        [cx - pad, cy - pad, z],
        [cx + pad, cy - pad, z],
        [cx + pad, cy + pad, z],
        [cx - pad, cy + pad, z],
      ],
      // Medium gray — needs to be light enough that the 25% black shadow
      // on top has visible contrast (the page background is near-black).
      color: "#7d848e",
    };
    groundHandleRef.current = scene.add(
      {
        polygons: [groundPoly],
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      { excludeFromAutoCenter: true, castShadow: false },
    );
    return () => {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
    };
  }, [
    showGround,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
  ]);

  // Effect 4 — light helper. Octahedron at LOCAL origin so polygons stay
  // stable across light moves; the light direction only updates the
  // mesh wrapper transform.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showLight) {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
      return;
    }
    const swatch = directionalLight.color ?? "#ffd54a";
    lightHandleRef.current = scene.add(
      {
        polygons: octahedronPolygons({ center: [0, 0, 0], size: helperScale * 0.05, color: swatch }),
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      {
        position: lightHelperPosition(
          directionalLight,
          helperTarget,
          helperScale * 0.7,
        ),
        excludeFromAutoCenter: true,
      },
    );
    return () => {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
    };
    // directionalLight.color triggers a remount because the swatch is
    // baked into polygon data; direction is handled by Effect 5 below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showLight,
    helperScale,
    directionalLight.color,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
  ]);

  // Effect 5 — slide the light helper to the new orbit position whenever
  // direction or target/distance change. Only updates the wrapper
  // transform, no atlas work.
  useEffect(() => {
    const handle = lightHandleRef.current;
    if (!handle) return;
    handle.setTransform({
      position: lightHelperPosition(
        directionalLight,
        helperTarget,
        helperScale * 0.7,
      ),
    });
  }, [directionalLight, helperTarget, helperScale]);

  return <div className="dn-vanilla-host" ref={hostRef} />;
}

export default function DebugWorkbench() {
  const [initialPreset] = useState<PresetModel>(() => routeInitialPreset() ?? randomPreset());
  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(() => sceneDefaultsFor(initialPreset));
  const [parserOptions, setParserOptions] = useState<ParserOptionsState>(() => parserStateFor(initialPreset));
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [droppedSource, setDroppedSource] = useState<DroppedModelSource | null>(null);
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const animationPausedRef = useRef(sceneOptions.animationPaused);
  animationPausedRef.current = sceneOptions.animationPaused;
  const animationTimeScaleRef = useRef(sceneOptions.animationTimeScale);
  animationTimeScaleRef.current = sceneOptions.animationTimeScale;
  const disableStrategiesRef = useRef(sceneOptions.disableStrategies);
  disableStrategiesRef.current = sceneOptions.disableStrategies;
  const [reactAnimatedPolygons, setReactAnimatedPolygons] = useState<Polygon[] | null>(null);
  const [metrics, setMetrics] = useState<DomMetrics>(EMPTY_METRICS);
  const [vanillaBuildMs, setVanillaBuildMs] = useState(0);
  const [modelSearch, setModelSearch] = useState("");
  const [openModelCategory, setOpenModelCategory] = useState<string | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropDepthRef = useRef(0);
  const droppedIdRef = useRef(0);
  const [dropActive, setDropActive] = useState(false);

  // Selection + drag state for the React renderer's <PolyMesh> wrapper.
  // Lives at this level so a model swap can reset both — the gizmo
  // shouldn't follow a stale handle, and a freshly loaded mesh should
  // sit at its authored origin.
  const meshRef = useRef<ReactPolyMeshHandle>(null);
  const [meshPosition, setMeshPosition] = useState<ReactVec3>([0, 0, 0]);
  const [meshRotation, setMeshRotation] = useState<ReactVec3>([0, 0, 0]);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [selectedMeshes, setSelectedMeshes] = useState<ReactPolyMeshHandle[]>([]);
  // Mirror of PolyTransformControls' drag state — three.js convention is to
  // disable OrbitControls while a transform gizmo is being dragged so
  // the camera doesn't co-rotate. Same idea here: gate PolyOrbitControls'
  // drag/wheel on this flag.
  const [gizmoDragging, setGizmoDragging] = useState(false);
  // Hover state for the mesh — wired the r3f / three.js way via
  // onPointerOver / onPointerOut on <PolyMesh>. Demonstrates the
  // mesh-event API (events.ts → InteractionProps) — same shape as
  // r3f, no raycasting needed because polycss uses DOM events.
  const [hoveredMeshId, setHoveredMeshId] = useState<string | null>(null);
  const autoZoomPresetRef = useRef<string | null>(null);
  const autoAmbientPresetRef = useRef<string | null>(null);
  const autoKeyPresetRef = useRef<string | null>(null);
  const guiHostRef = useRef<HTMLDivElement | null>(null);
  const guiRef = useRef<GUI | null>(null);
  const guiControllersRef = useRef<GuiControllerMap>({});
  // Mesh handle for the currently rendered model (vanilla path only). The
  // Inspector folder uses this to push color-group edits back into the
  // scene via setPolygons. Set by VanillaScene's onMeshHandleChange.
  const activeMeshHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const statsFrameRef = useRef<number | null>(null);
  // Vanilla selection state — kept separate from React's
  // `selectedMeshes` because vanilla MeshHandles aren't comparable to
  // React PolyMeshHandles. Stored as IDs since that's what both paths
  // can agree on for the toolbar display.
  const [vanillaSelectedIds, setVanillaSelectedIds] = useState<string[]>([]);

  const updateScene = useCallback((partial: Partial<SceneOptionsState>) => {
    setSceneOptions((current) => ({ ...current, ...partial }));
  }, []);

  // Mirror controls-driven camera changes (drag/wheel/autorotate) back into
  // React state. Without this, the sliders don't track the live drag and a
  // subsequent scene rebuild (baked → dynamic, mesh swap, etc.) reads the
  // stale slider value and resets the user's camera.
  const handleCameraChange = useCallback((camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 }) => {
    setSceneOptions((current) => {
      const nextTarget = camera.target ?? current.target;
      if (
        current.rotX === camera.rotX &&
        current.rotY === camera.rotY &&
        current.zoom === camera.zoom &&
        current.target[0] === nextTarget[0] &&
        current.target[1] === nextTarget[1] &&
        current.target[2] === nextTarget[2]
      ) return current;
      return {
        ...current,
        rotX: camera.rotX,
        rotY: camera.rotY,
        zoom: camera.zoom,
        target: [nextTarget[0], nextTarget[1], nextTarget[2]],
      };
    });
  }, []);

  const availablePresets = useMemo(
    () => droppedSource ? [droppedSource.preset, ...PRESETS] : PRESETS,
    [droppedSource],
  );
  const pickerItems = useMemo(
    () => droppedSource ? [presetPickerItem(droppedSource.preset, true), ...PRESET_PICKER_ITEMS] : PRESET_PICKER_ITEMS,
    [droppedSource],
  );
  const selectedPreset = availablePresets.find((preset) => preset.id === presetId) ?? PRESETS[0];
  const selectedDroppedSource = droppedSource?.id === selectedPreset.id ? droppedSource : null;
  const selectedPresetPickerCategory =
    pickerItems.find((preset) => preset.id === selectedPreset.id)?.category ??
    galleryBucketForPreset(selectedPreset);
  const trimmedModelSearch = modelSearch.trim().toLowerCase();
  const filteredPresetItems = useMemo(() => {
    if (!trimmedModelSearch) return pickerItems;
    return pickerItems.filter((preset) =>
      preset.label.toLowerCase().includes(trimmedModelSearch) ||
      preset.category.toLowerCase().includes(trimmedModelSearch),
    );
  }, [pickerItems, trimmedModelSearch]);
  const modelCategories = useMemo(() => {
    const buckets = new Map<string, { id: string; label: string; models: typeof PRESET_PICKER_ITEMS }>();
    if (!trimmedModelSearch) {
      for (const category of GALLERY_BUCKET_ORDER) {
        buckets.set(category, { id: category, label: category, models: [] as typeof PRESET_PICKER_ITEMS });
      }
    }
    for (const preset of filteredPresetItems) {
      const category = preset.category || "Other";
      if (!buckets.has(category)) {
        buckets.set(category, { id: category, label: category, models: [] as typeof PRESET_PICKER_ITEMS });
      }
      buckets.get(category)!.models.push(preset);
    }
    const orderedCategories = Array.from(buckets.values()).sort((a, b) =>
      galleryBucketRank(a.id) - galleryBucketRank(b.id)
    );
    for (const category of orderedCategories) {
      category.models.sort((a, b) => a.label.localeCompare(b.label));
    }
    return orderedCategories;
  }, [filteredPresetItems, trimmedModelSearch]);
  const defaultCategoryId = modelCategories.find((category) => category.models.length > 0)?.id ?? modelCategories[0]?.id;
  const isCategoryOpen = useCallback(
    (categoryId: string): boolean => {
      if (trimmedModelSearch) return true;
      if (openModelCategory !== null) return categoryId === openModelCategory;
      return categoryId === selectedPresetPickerCategory || categoryId === defaultCategoryId;
    },
    [trimmedModelSearch, openModelCategory, selectedPresetPickerCategory, defaultCategoryId],
  );
  const handleToggleCategory = useCallback((categoryId: string) => {
    setOpenModelCategory((prev) => (prev === categoryId ? null : categoryId));
  }, []);
  const modelTreeId = useMemo(() => {
    const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "");
    return modelCategories.map((category) => `debug-model-cat-${slug(category.id) || "category"}`);
  }, [modelCategories]);

  useEffect(() => {
    if (trimmedModelSearch) {
      return;
    }
    setOpenModelCategory((prev) => (prev === selectedPresetPickerCategory ? prev : selectedPresetPickerCategory));
  }, [trimmedModelSearch, selectedPresetPickerCategory]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const run = async () => {
      const presetForLoad = selectedPreset;
      try {
        disposeRef.current?.();
        disposeRef.current = null;
        const next = selectedDroppedSource
          ? await loadDroppedModel(selectedDroppedSource, parserOptions)
          : await loadPresetModel(presetForLoad, parserOptions);
        if (cancelled) {
          next.dispose();
          return;
        }
        disposeRef.current = next.dispose;
        const nextZoom = autoZoomPresetRef.current !== presetForLoad.id
          ? defaultZoomForModel(presetForLoad, next.rawPolygons)
          : null;
        const nextAmbient = autoAmbientPresetRef.current !== presetForLoad.id
          ? smartAmbientForModel(presetForLoad, next.rawPolygons)
          : null;
        const nextKey = autoKeyPresetRef.current !== presetForLoad.id
          ? smartKeyIntensityForModel(next.rawPolygons)
          : null;

        if (nextZoom !== null || nextAmbient !== null || nextKey !== null) {
          setSceneOptions((current) => {
            const zoom = nextZoom ?? current.zoom;
            const ambientIntensity = nextAmbient ?? current.ambientIntensity;
            const lightIntensity = nextKey ?? current.lightIntensity;
            if (
              current.zoom === zoom &&
              current.ambientIntensity === ambientIntensity &&
              current.lightIntensity === lightIntensity
            ) return current;
            return { ...current, zoom, ambientIntensity, lightIntensity };
          });
          autoZoomPresetRef.current = presetForLoad.id;
          autoAmbientPresetRef.current = presetForLoad.id;
          autoKeyPresetRef.current = presetForLoad.id;
        }
        setLoaded(next);
      } catch (error) {
        if (cancelled) return;
        setLoaded(null);
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedPreset, selectedDroppedSource, parserOptions]);

  useEffect(() => {
    return () => {
      disposeRef.current?.();
    };
  }, []);

  // Drop selection + reset gizmo position when the model changes. The
  // PolyMesh wrapper persists across model swaps, so without this the
  // user would inherit the previous model's drag offset.
  useEffect(() => {
    setSelectedMeshes([]);
    setVanillaSelectedIds([]);
    setMeshPosition([0, 0, 0]);
    setMeshRotation([0, 0, 0]);
  }, [loaded?.label]);

  const directionalLight = useMemo(
    () => directionalFromOptions(sceneOptions),
    [
      sceneOptions.lightAzimuth,
      sceneOptions.lightElevation,
      sceneOptions.lightColor,
      sceneOptions.lightIntensity,
    ],
  );
  const ambientLight = useMemo(
    () => ambientFromOptions(sceneOptions),
    [sceneOptions.ambientColor, sceneOptions.ambientIntensity],
  );
  const textureQuality = sceneOptions.textureQuality;

  const animationClips = loaded?.animation?.clips ?? [];
  const hasAnimation = animationClips.length > 0;
  const activeAnimation = useMemo(
    () => animationClips.find((clip) => String(clip.index) === selectedAnimation) ?? null,
    [animationClips, selectedAnimation],
  );
  const hasActiveAnimation = activeAnimation !== null;
  useEffect(() => {
    setReactAnimatedPolygons(null);
    if (!loaded?.animation || !activeAnimation || sceneOptions.renderer !== "react") return;
    let raf = 0;
    let last = performance.now();
    let elapsedSeconds = 0;
    let sampledSeconds: number | null = null;

    const tick = (now: number) => {
      const deltaSeconds = Math.max(0, (now - last) / 1000);
      last = now;
      if (!animationPausedRef.current) {
        elapsedSeconds += deltaSeconds * animationTimeScaleRef.current;
      }
      if (sampledSeconds !== elapsedSeconds) {
        sampledSeconds = elapsedSeconds;
        setReactAnimatedPolygons(loaded.animation!.sample(activeAnimation.index, elapsedSeconds));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loaded, activeAnimation, sceneOptions.renderer]);

  const vanillaAnimationFrameFactory = useMemo(() => {
    if (!loaded?.animation || !activeAnimation || sceneOptions.renderer !== "vanilla") return undefined;
    return (timeSeconds: number) => {
      return loaded.animation!.sample(activeAnimation.index, timeSeconds);
    };
  }, [
    loaded,
    activeAnimation,
    sceneOptions.renderer,
  ]);

  const modelPolygons = useMemo(() => {
    if (!loaded) return [];
    if (hasActiveAnimation) {
      return sceneOptions.renderer === "react" && reactAnimatedPolygons
        ? reactAnimatedPolygons
        : loaded.rawPolygons;
    }
    return optimizeMeshPolygons(loaded.rawPolygons, {
      meshResolution: sceneOptions.meshResolution,
    });
  }, [
    loaded,
    hasActiveAnimation,
    sceneOptions.meshResolution,
    sceneOptions.renderer,
    reactAnimatedPolygons,
  ]);

  const scenePolygons = useMemo(() => {
    if (
      hasActiveAnimation ||
      !sceneOptions.meshInteriorFill
    ) {
      return modelPolygons;
    }
    return withInteriorFillPolygons(modelPolygons);
  }, [
    hasActiveAnimation,
    modelPolygons,
    sceneOptions.meshInteriorFill,
  ]);
  const debugShapeLabels = DEBUG_SHAPE_LABELS;

  const helperBbox = useMemo(() => {
    const polygons = scenePolygons;
    if (polygons.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const polygon of polygons) {
      for (const v of polygon.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }, [scenePolygons]);

  const helperScale = useMemo(() => {
    if (!helperBbox) return 30;
    return Math.max(
      helperBbox.maxX - helperBbox.minX,
      helperBbox.maxY - helperBbox.minY,
      helperBbox.maxZ - helperBbox.minZ,
      1,
    );
  }, [helperBbox]);

  const helperTarget = useMemo<[number, number, number]>(() => {
    if (!helperBbox) return [0, 0, 0];
    return [
      (helperBbox.minX + helperBbox.maxX) / 2,
      (helperBbox.minY + helperBbox.maxY) / 2,
      (helperBbox.minZ + helperBbox.maxZ) / 2,
    ];
  }, [helperBbox]);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setMetrics(measureDom(root));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener(DOM_OVERPAINT_CACHE_EVENT, schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener(DOM_OVERPAINT_CACHE_EVENT, schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      applyDebugMatrixPrecision(root, sceneOptions.matrixPrecision);
      applyDebugBorderShapePrecision(root, sceneOptions.borderShapePrecision);
      applyDebugTriangleBrushPrecision(root);
      applyDebugSolidColorHex(root);
      applyDebugInlineStyleOrder(root);
      applyDebugInlineStyleMinify(root);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    sceneOptions.matrixPrecision,
    sceneOptions.borderShapePrecision,
    sceneOptions.renderer,
    sceneOptions.textureLighting,
    sceneOptions.textureQuality,
    scenePolygons,
    vanillaBuildMs,
  ]);

  const rendererDebugKey = useMemo(
    () => [
      sceneOptions.renderer,
      sceneOptions.matrixPrecision,
      sceneOptions.borderShapePrecision,
      sceneOptions.textureLighting,
      sceneOptions.textureQuality,
      sceneOptions.experimentalTextureEdgeRepair ? "edge-repair" : "no-edge-repair",
      sceneOptions.autoCenter,
      sceneOptions.perspective === false ? "none" : sceneOptions.perspective,
      loaded?.label ?? "none",
    ].join(":"),
    [
      sceneOptions.renderer,
      sceneOptions.matrixPrecision,
      sceneOptions.borderShapePrecision,
      sceneOptions.textureLighting,
      sceneOptions.textureQuality,
      sceneOptions.experimentalTextureEdgeRepair,
      sceneOptions.autoCenter,
      sceneOptions.perspective,
      loaded?.label,
    ],
  );

  const resetToPreset = useCallback((id: string, options: { updateRoute?: boolean } = {}) => {
    const next = availablePresets.find((preset) => preset.id === id);
    autoZoomPresetRef.current = null;
    autoAmbientPresetRef.current = null;
    autoKeyPresetRef.current = null;
    setPresetId(id);
    setSelectedAnimation("");
    setReactAnimatedPolygons(null);
    if (!next) return;
    if (options.updateRoute) {
      if (droppedSource?.id === next.id) setRoutePresetId(null);
      else setRoutePresetId(next.id);
    }
    setParserOptions((current) => ({
      ...current,
      ...parserDefaultsFor(next),
    }));
    setSceneOptions((current) => ({
      ...current,
      rotX: next.rotX ?? current.rotX,
      rotY: next.rotY ?? current.rotY,
    }));
  }, [availablePresets, droppedSource]);
  const handleRandomPreset = useCallback(() => {
    const next = randomPreset();
    resetToPreset(next.id, { updateRoute: true });
  }, [resetToPreset]);

  const handleDroppedFiles = useCallback((files: File[]) => {
    const source = droppedSourceFromFiles(
      files,
      `dropped-${Date.now().toString(36)}-${(droppedIdRef.current += 1).toString(36)}`,
    );
    if (!source) {
      setLoadError("Drop an .obj, .glb, or .vox file.");
      return;
    }

    autoZoomPresetRef.current = null;
    autoAmbientPresetRef.current = null;
    autoKeyPresetRef.current = null;
    setRoutePresetId(null);
    setDroppedSource(source);
    setPresetId(source.id);
    setSelectedAnimation("");
    setReactAnimatedPolygons(null);
    setParserOptions((current) => ({
      ...current,
      ...parserDefaultsFor(source.preset),
    }));
    setSceneOptions((current) => ({
      ...current,
      rotX: source.preset.rotX ?? current.rotX,
      rotY: source.preset.rotY ?? current.rotY,
    }));
  }, []);

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    handleDroppedFiles(fileListToArray(event.currentTarget.files));
    event.currentTarget.value = "";
  }, [handleDroppedFiles]);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dropDepthRef.current += 1;
    setDropActive(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) setDropActive(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dropDepthRef.current = 0;
    setDropActive(false);
    handleDroppedFiles(fileListToArray(event.dataTransfer.files));
  }, [handleDroppedFiles]);

  useEffect(() => {
    const routeValue = getRoutePresetValue();
    if (routeValue) {
      const routePresetId = resolveRoutePresetId(routeValue);
      if (routePresetId) {
        setRoutePresetId(routePresetId);
      } else {
        setRoutePresetId(null);
      }
    }

    const handlePopState = () => {
      const nextRouteValue = getRoutePresetValue();
      if (!nextRouteValue) return;
      const nextPresetId = resolveRoutePresetId(nextRouteValue);
      if (!nextPresetId) {
        setRoutePresetId(null);
        return;
      }
      if (nextPresetId !== presetId) {
        resetToPreset(nextPresetId);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [presetId, resetToPreset]);

  const animationOptions = useMemo(() => {
    const options: Record<string, string> = { None: "" };
    for (const clip of animationClips) {
      options[`${clip.name} (${clip.duration.toFixed(2)}s)`] = String(clip.index);
    }
    return options;
  }, [animationClips]);
  const perspectiveMode = sceneOptions.perspective === false ? "orthographic" : "perspective";
  const perspectivePx = sceneOptions.perspective === false ? 8000 : sceneOptions.perspective;

  useEffect(() => {
    const host = guiHostRef.current;
    if (!host || guiRef.current) return;

    const gui = new GUI({ autoPlace: false, container: host, width: 360, closeFolders: true });
    gui.open();
    guiRef.current = gui;

    const modelState = {
      meshResolution: sceneOptions.meshResolution,
      meshInteriorFill: sceneOptions.meshInteriorFill,
      domCount: 0,
      sprites: 0,
      shapeRectangle: 0,
      shapeTriangle: 0,
      shapeIrregular: 0,
      overpaintPercent: 0,
      // The Texture Quality row binds the slider to `textureQualityValue`
      // and the Auto toggle to `textureQualityAuto`. The effective option
      // passed to the scene is "auto" when textureQualityAuto is true, else
      // textureQualityValue (clamped to 0.1..1). Keeping them as two fields
      // lets the slider preserve its last numeric value while Auto is on.
      textureQualityValue: typeof sceneOptions.textureQuality === "number"
        ? sceneOptions.textureQuality
        : 1,
      textureQualityAuto: sceneOptions.textureQuality === "auto",
      experimentalTextureEdgeRepair: sceneOptions.experimentalTextureEdgeRepair,
    };

    const animationState = {
      animation: selectedAnimation,
      animationPaused: sceneOptions.animationPaused,
      animationTimeScale: sceneOptions.animationTimeScale,
    };

    const interactionState = {
      interactive: sceneOptions.interactive,
      selection: sceneOptions.selection,
      hoverEffects: sceneOptions.hoverEffects,
      gizmoMode,
    };

    const cameraState = {
      autoRotate: sceneOptions.animate,
      autoCenter: sceneOptions.autoCenter,
      showAxes: sceneOptions.showAxes,
      dragMode: sceneOptions.dragMode,
      projection: perspectiveMode,
      perspectivePx,
      zoom: sceneOptions.zoom,
      rotX: sceneOptions.rotX,
      rotY: sceneOptions.rotY,
      targetX: sceneOptions.target[0],
      targetY: sceneOptions.target[1],
      targetZ: sceneOptions.target[2],
    };

    const lightState = {
      textureLighting: sceneOptions.textureLighting,
      showLight: sceneOptions.showLight,
      lightAzimuth: sceneOptions.lightAzimuth,
      lightElevation: sceneOptions.lightElevation,
      lightIntensity: sceneOptions.lightIntensity,
      lightColor: sceneOptions.lightColor,
      ambientIntensity: sceneOptions.ambientIntensity,
      ambientColor: sceneOptions.ambientColor,
      castShadow: sceneOptions.castShadow,
      showGround: sceneOptions.showGround,
    };

    const model = gui.addFolder("Model");
    model.open();
    const domCountController = disableWithoutDisabledClass(
      model.add(modelState, "domCount").name("DOM nodes"),
    );
    const spritesController = disableWithoutDisabledClass(
      model.add(modelState, "sprites").name("Sprites <s>"),
    );
    const shapeRectangleController = disableWithoutDisabledClass(
      model.add(modelState, "shapeRectangle").name(debugShapeLabels.rectangle),
    );
    const shapeTriangleController = disableWithoutDisabledClass(
      model.add(modelState, "shapeTriangle").name(debugShapeLabels.triangle),
    );
    const shapeIrregularController = disableWithoutDisabledClass(
      model.add(modelState, "shapeIrregular").name(debugShapeLabels.irregular),
    );

    function injectStrategyCheckbox(
      controller: { domElement?: HTMLElement } | undefined | null,
      strategy: PolyRenderStrategy,
    ): HTMLInputElement | null {
      const dom = controller?.domElement;
      const widget = dom?.querySelector?.<HTMLElement>(".widget");
      if (!widget) return null;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "dn-strategy-toggle";
      checkbox.checked = !disableStrategiesRef.current.includes(strategy);
      checkbox.addEventListener("change", () => {
        const current = disableStrategiesRef.current;
        updateScene({
          disableStrategies: checkbox.checked
            ? current.filter((s) => s !== strategy)
            : [...current.filter((s) => s !== strategy), strategy],
        });
      });
      widget.appendChild(checkbox);
      return checkbox;
    }

    const bToggle = injectStrategyCheckbox(shapeRectangleController, "b");
    const uToggle = injectStrategyCheckbox(shapeTriangleController, "u");
    const iToggle = injectStrategyCheckbox(shapeIrregularController, "i");
    const overpaintPercentController = disableWithoutDisabledClass(
      model.add(modelState, "overpaintPercent").name("Overpaint %"),
    );

    const rendering = gui.addFolder("Rendering");
    rendering.open();
    const meshResolutionController = rendering
      .add(modelState, "meshResolution", { Lossless: "lossless", Lossy: "lossy" })
      .name("Mesh resolution")
      .onChange((value: MeshResolution) => updateScene({ meshResolution: value }));
    const meshInteriorFillController = rendering
      .add(modelState, "meshInteriorFill")
      .name("Interior fill")
      .onChange((value: boolean) => updateScene({ meshInteriorFill: value }));
    const textureEdgeRepairController = rendering
      .add(modelState, "experimentalTextureEdgeRepair")
      .name("Edge repair")
      .onChange((value: boolean) => updateScene({ experimentalTextureEdgeRepair: value }));
    const textureLightingController = rendering
      .add(lightState, "textureLighting", { baked: "baked", dynamic: "dynamic" })
      .name("Texture")
      .onChange((value: PolyTextureLightingMode) => updateScene({ textureLighting: value }));

    const textureQualityController = rendering
      .add(modelState, "textureQualityValue", 0.1, 1, 0.05)
      .name("Texture quality")
      .onChange((value: number) => {
        // Touching the slider switches off Auto and commits the numeric value.
        modelState.textureQualityAuto = false;
        if (textureQualityAutoCheckbox) textureQualityAutoCheckbox.checked = false;
        updateScene({ textureQuality: value });
      });

    let textureQualityAutoCheckbox: HTMLInputElement | null = null;
    function injectAutoToggle(
      controller: { domElement?: HTMLElement } | undefined | null,
    ): HTMLInputElement | null {
      const dom = controller?.domElement;
      const widget = dom?.querySelector?.<HTMLElement>(".widget");
      if (!widget) return null;
      // Layout matches the slider rows above (Azimuth / Elev / Key / Ambient):
      // [Texture quality (label)] [checkbox Auto] [slider] [number]. The
      // checkbox + label are injected at the START of the widget; lil-gui's
      // slider + value input occupy the rest of the row.
      const wrap = document.createElement("label");
      wrap.className = "dn-auto-toggle";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = modelState.textureQualityAuto;
      const lbl = document.createElement("span");
      lbl.textContent = "Auto";
      wrap.appendChild(cb);
      wrap.appendChild(lbl);
      cb.addEventListener("change", () => {
        modelState.textureQualityAuto = cb.checked;
        if (cb.checked) {
          disableWithoutDisabledClass(textureQualityController);
          updateScene({ textureQuality: "auto" });
        } else {
          textureQualityController.enable();
          updateScene({ textureQuality: modelState.textureQualityValue });
        }
      });
      widget.insertBefore(wrap, widget.firstChild);
      if (modelState.textureQualityAuto) disableWithoutDisabledClass(textureQualityController);
      return cb;
    }
    textureQualityAutoCheckbox = injectAutoToggle(textureQualityController);

    const animation = gui.addFolder("Animation");
    animation.open();
    const animationController = animation
      .add(animationState, "animation", animationOptions)
      .name("Sequence")
      .onChange((value: string) => {
        setSelectedAnimation(value);
        setReactAnimatedPolygons(null);
      });
    const animationPausedController = animation
      .add(animationState, "animationPaused")
      .name("Paused")
      .onChange((value: boolean) => updateScene({ animationPaused: value }));
    const animationTimeScaleController = animation
      .add(animationState, "animationTimeScale", -3, 3, 0.05)
      .name("Playback speed")
      .onChange((value: number) => updateScene({ animationTimeScale: value }));

    const interaction = gui.addFolder("Interaction");
    const interactiveController = interaction
      .add(interactionState, "interactive")
      .name("Scene interactive")
      .onChange((value: boolean) => updateScene({ interactive: value }));
    const hoverController = interaction
      .add(interactionState, "hoverEffects")
      .name("Mesh hover")
      .onChange((value: boolean) => updateScene({ hoverEffects: value }));
    const selectionController = interaction
      .add(interactionState, "selection")
      .name("Mesh selection")
      .onChange((value: boolean) => updateScene({ selection: value }));
    const gizmoController = interaction
      .add(interactionState, "gizmoMode", { translate: "translate", rotate: "rotate" })
      .name("Gizmo")
      .onChange((value: GizmoMode) => setGizmoMode(value));

    const camera = gui.addFolder("Camera");
    camera.close();
    camera
      .add({ resetCamera: () => {
        const resetZoom = loaded ? defaultZoomForModel(selectedPreset, loaded.rawPolygons) : selectedPreset.zoom ?? 0.35;
        updateScene({
          zoom: resetZoom,
          rotX: selectedPreset.rotX ?? 65,
          rotY: selectedPreset.rotY ?? 45,
          target: [0, 0, 0],
        });
      } }, "resetCamera")
      .name("Reset camera");
    const autoCenterController = camera
      .add(cameraState, "autoCenter")
      .name("Auto center")
      .onChange((value: boolean) => updateScene({ autoCenter: value }));
    const axesController = camera
      .add(cameraState, "showAxes")
      .name("Axes")
      .onChange((value: boolean) => updateScene({ showAxes: value }));
    const autoRotateController = camera
      .add(cameraState, "autoRotate")
      .name("Auto rotate")
      .onChange((value: boolean) => updateScene({ animate: value }));
    const dragModeController = camera
      .add(cameraState, "dragMode", { Orbit: "orbit", Pan: "pan" })
      .name("Drag")
      .onChange((value: DragMode) => updateScene({ dragMode: value }));
    const projectionController = camera
      .add(cameraState, "projection", { Perspective: "perspective", Orthographic: "orthographic" })
      .name("Projection")
      .onChange((value: PerspectiveMode) => {
        updateScene({ perspective: value === "perspective" ? cameraState.perspectivePx : false });
      });
    const perspectivePxController = camera
      .add(cameraState, "perspectivePx", { "1000 px": 1000, "2000 px": 2000, "4000 px": 4000, "8000 px": 8000 })
      .name("Perspective px")
      .onChange((value: number) => updateScene({ perspective: value }));
    const zoomController = camera
      .add(cameraState, "zoom", 0.05, 2.5, 0.01)
      .name("Zoom")
      .onChange((value: number) => updateScene({ zoom: value }));
    const rotXController = camera
      .add(cameraState, "rotX", 0, 100, 1)
      .name("Rot X")
      .onChange((value: number) => updateScene({ rotX: value }));
    const rotYController = camera
      .add(cameraState, "rotY", 0, 360, 1)
      .name("Rot Y")
      .onChange((value: number) => updateScene({ rotY: value }));
    const targetXController = camera
      .add(cameraState, "targetX", -50, 50, 0.1)
      .name("Target X")
      .onChange((value: number) => updateScene({ target: [value, cameraState.targetY, cameraState.targetZ] }));
    const targetYController = camera
      .add(cameraState, "targetY", -50, 50, 0.1)
      .name("Target Y")
      .onChange((value: number) => updateScene({ target: [cameraState.targetX, value, cameraState.targetZ] }));
    const targetZController = camera
      .add(cameraState, "targetZ", -50, 50, 0.1)
      .name("Target Z")
      .onChange((value: number) => updateScene({ target: [cameraState.targetX, cameraState.targetY, value] }));

    const lights = gui.addFolder("Lighting");
    lights.open();
    const castShadowController = lights
      .add(lightState, "castShadow")
      .name("Cast shadow")
      .onChange((value: boolean) => updateScene({ castShadow: value }));
    const showGroundController = lights
      .add(lightState, "showGround")
      .name("Show ground")
      .onChange((value: boolean) => updateScene({ showGround: value }));
    const lightController = lights
      .add(lightState, "showLight")
      .name("Light helper")
      .onChange((value: boolean) => updateScene({ showLight: value }));
    const azimuthController = lights
      .add(lightState, "lightAzimuth", 0, 360, 1)
      .name("Azimuth")
      .onChange((value: number) => updateScene({ lightAzimuth: value }));
    const elevationController = lights
      .add(lightState, "lightElevation", -90, 90, 1)
      .name("Elev.")
      .onChange((value: number) => updateScene({ lightElevation: value }));
    const intensityController = lights
      .add(lightState, "lightIntensity", 0, 2, 0.05)
      .name("Key")
      .onChange((value: number) => updateScene({ lightIntensity: value }));
    const keyColorController = lights
      .addColor(lightState, "lightColor")
      .name("Key color")
      .onChange((value: string) => updateScene({ lightColor: value }));
    const ambientIntensityController = lights
      .add(lightState, "ambientIntensity", 0, 2, 0.05)
      .name("Ambient")
      .onChange((value: number) => updateScene({ ambientIntensity: value }));
    const ambientColorController = lights
      .addColor(lightState, "ambientColor")
      .name("Amb. color")
      .onChange((value: string) => updateScene({ ambientColor: value }));

    if (sceneOptions.perspective === false) {
      perspectivePxController.hide();
    }
    if (activeAnimation) {
      meshResolutionController.disable();
      meshInteriorFillController.disable();
    }
    if (!sceneOptions.selection) {
      gizmoController.disable();
    }
    if (animationClips.length === 0) {
      animation.hide();
      animationController.disable();
      animationPausedController.disable();
      animationTimeScaleController.disable();
    }

    guiControllersRef.current = {
      animation: animationController,
      animationPaused: animationPausedController,
      animationTimeScale: animationTimeScaleController,
      domCount: domCountController,
      sprites: spritesController,
      shapeRectangle: shapeRectangleController,
      shapeTriangle: shapeTriangleController,
      shapeIrregular: shapeIrregularController,
      bToggle,
      uToggle,
      iToggle,
      overpaintPercent: overpaintPercentController,
      meshResolution: meshResolutionController,
      meshInteriorFill: meshInteriorFillController,
      textureQuality: textureQualityController,
      textureQualityAutoCheckbox,
      experimentalTextureEdgeRepair: textureEdgeRepairController,
      interactive: interactiveController,
      autoRotate: autoRotateController,
      selection: selectionController,
      hoverEffects: hoverController,
      gizmoMode: gizmoController,
      textureLighting: textureLightingController,
      autoCenter: autoCenterController,
      showAxes: axesController,
      dragMode: dragModeController,
      projection: projectionController,
      perspectivePx: perspectivePxController,
      zoom: zoomController,
      rotX: rotXController,
      rotY: rotYController,
      targetX: targetXController,
      targetY: targetYController,
      targetZ: targetZController,
      castShadow: castShadowController,
      showGround: showGroundController,
      showLight: lightController,
      lightAzimuth: azimuthController,
      lightElevation: elevationController,
      lightIntensity: intensityController,
      lightColor: keyColorController,
      ambientIntensity: ambientIntensityController,
      ambientColor: ambientColorController,
      modelState,
      animationState,
      animationFolder: animation,
      interactionState,
      cameraState,
      lightState,
    };

    return () => {
      gui.destroy();
      guiRef.current = null;
      guiControllersRef.current = {};
    };
  }, []);

  // Inspector data — grouped by mesh, then by polygon color. Recomputed
  // when scenePolygons or the loaded model change. Mutations to a
  // polygon's color via the picker do NOT change the scenePolygons
  // reference, so this memo doesn't re-fire on each tweak and the swatch
  // local state stays in sync.
  const inspectorMeshes = useMemo<InspectorMesh[]>(() => {
    if (scenePolygons.length === 0) return [];
    const colorGroups = new Map<string, Polygon[]>();
    const textured: Polygon[] = [];
    for (const p of scenePolygons) {
      if (p.texture) {
        textured.push(p);
        continue;
      }
      if (!p.color) continue;
      let arr = colorGroups.get(p.color);
      if (!arr) {
        arr = [];
        colorGroups.set(p.color, arr);
      }
      arr.push(p);
    }
    if (colorGroups.size === 0 && textured.length === 0) return [];
    const sortedColors = [...colorGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([color, polys]) => ({
        color,
        count: polys.length,
        editable: true,
        polygons: polys,
      }));
    const groups: InspectorColorGroup[] = sortedColors;
    if (textured.length > 0) {
      groups.push({
        color: "textured",
        count: textured.length,
        editable: false,
        polygons: textured,
      });
    }
    const label = loaded?.label ?? "model";
    return [{ id: label, label, groups }];
  }, [scenePolygons, loaded?.label]);

  const handleInspectorColorChange = useCallback(
    (
      _mesh: InspectorMesh,
      group: InspectorColorGroup,
      next: string,
    ) => {
      for (const p of group.polygons) p.color = next;
      const handle = activeMeshHandleRef.current;
      // Pass the *source* polygons (pre-merge) — the renderer holds a
      // merged copy that doesn't see in-place edits. setPolygons without
      // an explicit merge flag reuses the mesh's current merge setting
      // (true for static models, false during animation playback).
      if (handle) handle.setPolygons(scenePolygons);
    },
    [scenePolygons],
  );

  useEffect(() => {
    const statsContainer = document.createElement("div");
    statsContainer.style.position = "fixed";
    statsContainer.style.right = "12px";
    statsContainer.style.bottom = "12px";
    statsContainer.style.zIndex = "30";
    statsContainer.style.top = "auto";
    statsContainer.style.left = "auto";
    statsContainer.style.display = "flex";
    statsContainer.style.alignItems = "flex-end";

    const stats = [0, 1, 2].map((mode) => {
      const stat = new Stats();
      stat.setMode(mode);
      stat.dom.style.position = "static";
      stat.dom.style.pointerEvents = "none";
      statsContainer.appendChild(stat.dom);
      return stat;
    });

    document.body.appendChild(statsContainer);

    const tick = () => {
      for (const stat of stats) {
        stat.update();
      }
      statsFrameRef.current = requestAnimationFrame(tick);
    };
    statsFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (statsFrameRef.current !== null) {
        cancelAnimationFrame(statsFrameRef.current);
      }
      statsContainer.remove();
      statsFrameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controllers = guiControllersRef.current;
    if (!guiRef.current || !controllers.modelState) return;

    const setCtrlValue = (key: string, value: unknown) => {
      const controller = controllers[key] as { object: Record<string, unknown>; updateDisplay: () => void } | undefined;
      if (!controller?.object) return;
      const stateKey = key;
      if (controller.object[stateKey] === value) return;
      controller.object[stateKey] = value;
      controller.updateDisplay();
    };
    const setEnabled = (key: string, enabled: boolean) => {
      const controller = controllers[key] as { disable: () => void; enable: () => void } | undefined;
      if (!controller?.disable || !controller?.enable) return;
      if (enabled) controller.enable();
      else controller.disable();
    };
    const setCtrlName = (key: string, value: string) => {
      const controller = controllers[key] as { name?: (next: string) => void } | undefined;
      controller?.name?.(value);
    };

    setCtrlValue("animation", selectedAnimation);
    setCtrlValue("animationPaused", sceneOptions.animationPaused);
    setCtrlValue("animationTimeScale", sceneOptions.animationTimeScale);
    setCtrlValue("meshResolution", sceneOptions.meshResolution);
    setCtrlValue("meshInteriorFill", sceneOptions.meshInteriorFill);
    setCtrlValue("experimentalTextureEdgeRepair", sceneOptions.experimentalTextureEdgeRepair);
    setCtrlValue("domCount", metrics.nodeCount);
    setCtrlValue("sprites", metrics.sprites);
    setCtrlValue("shapeRectangle", metrics.rects);
    setCtrlValue("shapeTriangle", metrics.triangles);
    setCtrlValue("shapeIrregular", metrics.irregular);
    const bToggleEl = controllers.bToggle as HTMLInputElement | undefined;
    const uToggleEl = controllers.uToggle as HTMLInputElement | undefined;
    const iToggleEl = controllers.iToggle as HTMLInputElement | undefined;
    if (bToggleEl) bToggleEl.checked = !sceneOptions.disableStrategies.includes("b");
    if (uToggleEl) uToggleEl.checked = !sceneOptions.disableStrategies.includes("u");
    if (iToggleEl) iToggleEl.checked = !sceneOptions.disableStrategies.includes("i");
    setCtrlValue("overpaintPercent", metrics.overpaintPercent);

    const validAnimation = Object.values(animationOptions).includes(selectedAnimation);
    const nextAnimation = validAnimation ? selectedAnimation : "";
    setCtrlValue("animation", nextAnimation);
    const animationController = controllers.animation as { options: (opts: Record<string, string>) => void } | undefined;
    animationController?.options(animationOptions);
    const animationFolder = controllers.animationFolder as { show: (show?: boolean) => void } | undefined;
    animationFolder?.show(animationClips.length > 0);
    if (animationController) {
      setEnabled("animation", animationClips.length > 0);
      setEnabled("animationPaused", animationClips.length > 0);
      setEnabled("animationTimeScale", animationClips.length > 0);
      if (!validAnimation && selectedAnimation !== "") {
        setSelectedAnimation("");
      }
    }

    setCtrlValue("interactive", sceneOptions.interactive);
    setCtrlValue("autoRotate", sceneOptions.animate);
    setCtrlValue("selection", sceneOptions.selection);
    setCtrlValue("hoverEffects", sceneOptions.hoverEffects);
    setCtrlValue("gizmoMode", gizmoMode);

    setCtrlValue("textureLighting", sceneOptions.textureLighting);
    setCtrlValue("autoCenter", sceneOptions.autoCenter);
    setCtrlValue("showAxes", sceneOptions.showAxes);
    setCtrlValue("castShadow", sceneOptions.castShadow);
    setCtrlValue("showGround", sceneOptions.showGround);

    setCtrlValue("dragMode", sceneOptions.dragMode);
    setCtrlValue("projection", perspectiveMode);
    setCtrlValue("perspectivePx", perspectivePx);
    setCtrlValue("zoom", sceneOptions.zoom);
    setCtrlValue("rotX", sceneOptions.rotX);
    setCtrlValue("rotY", sceneOptions.rotY);
    setCtrlValue("targetX", sceneOptions.target[0]);
    setCtrlValue("targetY", sceneOptions.target[1]);
    setCtrlValue("targetZ", sceneOptions.target[2]);

    setCtrlValue("showLight", sceneOptions.showLight);
    setCtrlValue("lightAzimuth", sceneOptions.lightAzimuth);
    setCtrlValue("lightElevation", sceneOptions.lightElevation);
    setCtrlValue("lightIntensity", sceneOptions.lightIntensity);
    setCtrlValue("lightColor", sceneOptions.lightColor);
    setCtrlValue("ambientIntensity", sceneOptions.ambientIntensity);
    setCtrlValue("ambientColor", sceneOptions.ambientColor);

    setEnabled("meshResolution", !hasActiveAnimation);
    setEnabled("meshInteriorFill", !hasActiveAnimation);
    setEnabled("gizmoMode", sceneOptions.selection);

    if (sceneOptions.perspective === false) {
      (controllers.perspectivePx as { hide: () => void })?.hide();
    } else {
      (controllers.perspectivePx as { show: () => void })?.show();
    }

    const modelState = controllers.modelState as {
      meshResolution?: MeshResolution;
      meshInteriorFill?: boolean;
      domCount?: number;
      sprites?: number;
      shapeRectangle?: number;
      shapeTriangle?: number;
      shapeIrregular?: number;
      overpaintPercent?: number;
      textureQualityValue?: number;
      textureQualityAuto?: boolean;
      experimentalTextureEdgeRepair?: boolean;
    };
    if (modelState) {
      modelState.meshResolution = sceneOptions.meshResolution;
      modelState.meshInteriorFill = sceneOptions.meshInteriorFill;
      modelState.domCount = metrics.nodeCount;
      modelState.sprites = metrics.sprites;
      modelState.shapeRectangle = metrics.rects;
      modelState.shapeTriangle = metrics.triangles;
      modelState.shapeIrregular = metrics.irregular;
      modelState.overpaintPercent = metrics.overpaintPercent;
      modelState.experimentalTextureEdgeRepair = sceneOptions.experimentalTextureEdgeRepair;
      // Mirror external textureQuality changes back into the slider state.
      // Numeric → slider value + auto off (slider enabled); "auto" → keep
      // last numeric value, auto on (slider disabled). User unchecks Auto
      // first to drag the slider — explicit mode switch.
      const tq = sceneOptions.textureQuality;
      const nextAuto = tq === "auto";
      modelState.textureQualityAuto = nextAuto;
      if (typeof tq === "number") modelState.textureQualityValue = tq;
      const tqCb = controllers.textureQualityAutoCheckbox as HTMLInputElement | undefined;
      const tqCtl = controllers.textureQuality as Controller | undefined;
      if (tqCb) tqCb.checked = nextAuto;
      if (tqCtl) {
        if (nextAuto) disableWithoutDisabledClass(tqCtl);
        else tqCtl.enable();
      }
    }
    const animationState = controllers.animationState as {
      animation?: string;
      animationPaused?: boolean;
      animationTimeScale?: number;
    };
    if (animationState) {
      animationState.animation = nextAnimation;
      animationState.animationPaused = sceneOptions.animationPaused;
      animationState.animationTimeScale = sceneOptions.animationTimeScale;
    }
    const interactionState = controllers.interactionState as {
      interactive?: boolean;
      selection?: boolean;
      hoverEffects?: boolean;
      gizmoMode?: GizmoMode;
    };
    if (interactionState) {
      interactionState.interactive = sceneOptions.interactive;
      interactionState.selection = sceneOptions.selection;
      interactionState.hoverEffects = sceneOptions.hoverEffects;
      interactionState.gizmoMode = gizmoMode;
    }
    const cameraState = controllers.cameraState as {
      autoRotate?: boolean;
      autoCenter?: boolean;
      showAxes?: boolean;
      dragMode?: DragMode;
      projection?: PerspectiveMode;
      perspectivePx?: number;
      zoom?: number;
      rotX?: number;
      rotY?: number;
      targetX?: number;
      targetY?: number;
      targetZ?: number;
    };
    if (cameraState) {
      cameraState.autoRotate = sceneOptions.animate;
      cameraState.autoCenter = sceneOptions.autoCenter;
      cameraState.showAxes = sceneOptions.showAxes;
      cameraState.dragMode = sceneOptions.dragMode;
      cameraState.projection = perspectiveMode;
      cameraState.perspectivePx = perspectivePx;
      cameraState.zoom = sceneOptions.zoom;
      cameraState.rotX = sceneOptions.rotX;
      cameraState.rotY = sceneOptions.rotY;
      cameraState.targetX = sceneOptions.target[0];
      cameraState.targetY = sceneOptions.target[1];
      cameraState.targetZ = sceneOptions.target[2];
    }
    const lightState = controllers.lightState as {
      textureLighting?: PolyTextureLightingMode;
      showLight?: boolean;
      lightAzimuth?: number;
      lightElevation?: number;
      lightIntensity?: number;
      lightColor?: string;
      ambientIntensity?: number;
      ambientColor?: string;
      castShadow?: boolean;
      showGround?: boolean;
    };
    if (lightState) {
      lightState.textureLighting = sceneOptions.textureLighting;
      lightState.showLight = sceneOptions.showLight;
      lightState.lightAzimuth = sceneOptions.lightAzimuth;
      lightState.lightElevation = sceneOptions.lightElevation;
      lightState.lightIntensity = sceneOptions.lightIntensity;
      lightState.lightColor = sceneOptions.lightColor;
      lightState.ambientIntensity = sceneOptions.ambientIntensity;
      lightState.ambientColor = sceneOptions.ambientColor;
      lightState.castShadow = sceneOptions.castShadow;
      lightState.showGround = sceneOptions.showGround;
    }
  }, [
    activeAnimation,
    hasAnimation,
    hasActiveAnimation,
    animationClips.length,
    animationOptions,
    loaded?.label,
    loaded?.kind,
    loaded?.sourcePolygons,
    modelPolygons.length,
    presetId,
    metrics.nodeCount,
    metrics.sprites,
    metrics.rects,
    metrics.triangles,
    metrics.irregular,
    metrics.overpaintPercent,
    vanillaBuildMs,
    sceneOptions.interactive,
    sceneOptions.animate,
    sceneOptions.selection,
    sceneOptions.hoverEffects,
    sceneOptions.renderer,
    sceneOptions.animationPaused,
    sceneOptions.animationTimeScale,
    sceneOptions.textureLighting,
    sceneOptions.experimentalTextureEdgeRepair,
    sceneOptions.autoCenter,
    sceneOptions.showAxes,
    sceneOptions.meshResolution,
    sceneOptions.meshInteriorFill,
    sceneOptions.dragMode,
    sceneOptions.perspective,
    sceneOptions.zoom,
    sceneOptions.rotX,
    sceneOptions.rotY,
    sceneOptions.target,
    sceneOptions.showLight,
    sceneOptions.lightAzimuth,
    sceneOptions.lightElevation,
    sceneOptions.lightIntensity,
    sceneOptions.lightColor,
    sceneOptions.ambientIntensity,
    sceneOptions.ambientColor,
    sceneOptions.disableStrategies,
    sceneOptions.castShadow,
    perspectiveMode,
    perspectivePx,
    gizmoMode,
    selectedAnimation,
  ]);

  return (
    <div
      className={`dn-root${dropActive ? " dn-root--drop-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <aside className="models-sidebar" aria-label="Models">
        <div className="models-sidebar__body dark-scrollbar">
          <div className="models-sidebar__header">
            <input
              className="model-search models-sidebar__search"
              type="search"
              placeholder="Search models"
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              autoComplete="off"
            />
            <button type="button" className="control-btn" onClick={() => fileInputRef.current?.click()}>
              Import
            </button>
            <button type="button" className="control-btn control-btn--primary" onClick={handleRandomPreset}>
              Load Random
            </button>
            <input
              ref={fileInputRef}
              className="model-file-input"
              type="file"
              multiple
              accept=".obj,.glb,.vox,.mtl,.png,.jpg,.jpeg,.webp,.gif,.bmp"
              onChange={handleFileInputChange}
            />
          </div>

            {modelCategories.length === 0 ? (
              <div className="model-empty">No matching models</div>
            ) : (
              <div className="model-tree dark-scrollbar" id="debug-model-tree">
                {modelCategories.map((category, index) => {
                const isOpen = isCategoryOpen(category.id);
                const treeId = modelTreeId[index];
                return (
                  <div key={category.id} className="tree-category" data-cat-id={category.id}>
                    <button
                      type="button"
                      className="tree-heading"
                      aria-expanded={isOpen}
                      aria-controls={treeId}
                      onClick={() => handleToggleCategory(category.id)}
                    >
                      <span className="tree-label">
                        <span className={`tree-caret${isOpen ? " open" : ""}`}>▸</span>
                        {category.label}
                      </span>
                      <span className="tree-count">{category.models.length}</span>
                    </button>
                    <div className="model-button-list dark-scrollbar" id={treeId} style={isOpen ? undefined : { display: "none" }}>
                      {category.models.map((preset) => (
                        <button
                          type="button"
                          key={preset.id}
                          className={`sidebar-item${preset.id === presetId ? " active" : ""}`}
                          onClick={() => resetToPreset(preset.id, { updateRoute: true })}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <AttributionCredit attribution={selectedPreset.attribution} />
        </div>
      </aside>

      <InspectorPanel
        meshes={inspectorMeshes}
        onColorChange={handleInspectorColorChange}
      />

      <main className="dn-main">
        <div
          className={`dn-viewport${sceneOptions.outlinePolygons ? " dn-viewport--outline-polygons" : ""}`}
          ref={viewportRef}
        >
          {sceneOptions.renderer === "vanilla" ? (
            <VanillaScene
              key={rendererDebugKey}
              polygons={scenePolygons}
              options={sceneOptions}
              directionalLight={directionalLight}
              ambientLight={ambientLight}
              showAxes={sceneOptions.showAxes}
              showLight={sceneOptions.showLight}
              showGround={sceneOptions.showGround}
              helperScale={helperScale}
              helperTarget={helperTarget}
              mergePolygonsForMesh={!hasActiveAnimation}
              stableDomForMesh={hasActiveAnimation}
              animationKey={activeAnimation ? `${selectedAnimation}:${loaded?.label ?? ""}` : undefined}
              animationFrameFactory={vanillaAnimationFrameFactory}
              onBuild={setVanillaBuildMs}
              onCameraChange={handleCameraChange}
              enableSelection={sceneOptions.selection}
              meshId={loaded?.label ?? "model"}
              onSelectionChange={setVanillaSelectedIds}
              gizmoMode={gizmoMode}
              enableHover={sceneOptions.hoverEffects}
              onHoverChange={setHoveredMeshId}
              onMeshHandleChange={(h) => { activeMeshHandleRef.current = h; }}
            />
          ) : (() => {
            const Cam = sceneOptions.perspective === false ? PolyOrthographicCamera : PolyPerspectiveCamera;
            const camProps = sceneOptions.perspective === false
              ? { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target }
              : { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target, perspective: sceneOptions.perspective };
            return (
              <Cam key={rendererDebugKey} {...camProps}>
                {sceneOptions.dragMode === "pan" ? (
                  <PolyMapControls
                    drag={sceneOptions.interactive && !gizmoDragging}
                    wheel={sceneOptions.interactive && !gizmoDragging}
                    animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
                    onInteractionEnd={handleCameraChange}
                  />
                ) : (
                  <PolyOrbitControls
                    drag={sceneOptions.interactive && !gizmoDragging}
                    wheel={sceneOptions.interactive && !gizmoDragging}
                    animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
                    onInteractionEnd={handleCameraChange}
                  />
                )}
                <PolyScene
                  polygons={[]}
                  centerPolygons={scenePolygons}
                  autoCenter={sceneOptions.autoCenter}
                  directionalLight={directionalLight}
                  ambientLight={ambientLight}
                  textureLighting={sceneOptions.textureLighting}
                  textureQuality={textureQuality}
                  strategies={{ disable: sceneOptions.disableStrategies }}
                  experimentalTextureEdgeRepair={sceneOptions.experimentalTextureEdgeRepair}
                >
                  {sceneOptions.selection ? (
                    <PolySelect onChange={setSelectedMeshes} clearOnMiss={false}>
                      <PolyMesh
                        ref={meshRef}
                        id={loaded?.label ?? "model"}
                        polygons={scenePolygons}
                        position={meshPosition}
                        rotation={meshRotation}
                        className={
                          sceneOptions.hoverEffects && hoveredMeshId === (loaded?.label ?? "model")
                            ? "dn-model-mesh is-hovered"
                            : "dn-model-mesh"
                        }
                        style={sceneOptions.hoverEffects ? { cursor: "pointer" } : undefined}
                        experimentalTextureEdgeRepair={sceneOptions.experimentalTextureEdgeRepair}
                        onPointerOver={
                          sceneOptions.hoverEffects
                            ? (event) => setHoveredMeshId(event.eventObject.id ?? null)
                            : undefined
                        }
                        onPointerOut={
                          sceneOptions.hoverEffects ? () => setHoveredMeshId(null) : undefined
                        }
                      />
                    </PolySelect>
                  ) : null}
                  {!sceneOptions.selection ? (
                    <PolyMesh
                      id={loaded?.label ?? "model"}
                      polygons={scenePolygons}
                      className="dn-model-mesh"
                      experimentalTextureEdgeRepair={sceneOptions.experimentalTextureEdgeRepair}
                    />
                  ) : null}
                  {sceneOptions.selection && selectedMeshes.length > 0 && (
                    <PolyTransformControls
                      object={meshRef}
                      mode={gizmoMode}
                      onObjectChange={(event) => {
                        if (event.position) setMeshPosition(event.position);
                        if (event.rotation) setMeshRotation(event.rotation);
                      }}
                      onDraggingChanged={setGizmoDragging}
                    />
                  )}
                  {sceneOptions.showAxes && <PolyAxesHelper size={helperScale * 0.6} />}
                  {sceneOptions.showLight && (
                    <PolyDirectionalLightHelper
                      light={directionalLight}
                      target={helperTarget}
                      distance={helperScale * 0.7}
                      size={helperScale * 0.05}
                    />
                  )}
                </PolyScene>
              </Cam>
            );
          })()}
        </div>
        {dropActive && <div className="drop-overlay">Drop OBJ / GLB / VOX</div>}
      </main>

      <div className="dn-floating-controls">
        <div ref={guiHostRef} />
        {loading && <p className="dn-note">Loading model...</p>}
        {loadError && <p className="dn-note dn-note--error">{loadError}</p>}
      </div>
    </div>
  );
}
