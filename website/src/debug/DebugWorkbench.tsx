import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  parseGltf,
  parseMtl,
  parseObj,
} from "@layoutit/polycss-react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  GltfParseOptions,
  ObjParseOptions,
  ParseAnimationController,
  PolyMeshHandle,
  Polygon,
  PolyTextureLightingMode,
  Vec3 as ReactVec3,
} from "@layoutit/polycss-react";
import { ModelPicker } from "./ModelPicker";
import {
  axesHelperPolygons,
  coverPlanarPolygons,
  createPolyControls,
  createPolyScene,
  createSelect,
  createTransformControls,
  octahedronPolygons,
  parseVox,
} from "@layoutit/polycss";
import type {
  ControlsHandle,
  MeshHandle,
  PolySceneOptions,
  SceneHandle,
  SelectionHandle,
  TransformControlsHandle,
  Vec3,
  VoxParseOptions,
} from "@layoutit/polycss";
import { preprocessModelPolygons } from "./meshDomNormalize";
import type { GeometryNormalizeOptions } from "./meshDomNormalize";
import { StatsJsPanel } from "./StatsJsPanel";
import "./debug-workbench.css";

type Renderer = "react" | "vanilla";
type ModelKind = "obj" | "glb" | "gltf" | "vox";
type TextureQuality = "auto" | "full" | "balanced" | "draft";
type MatrixPrecision = "exact" | "2" | "3" | "4" | "5" | "6";
type BorderShapePrecision = "exact" | "2" | "3" | "4" | "5" | "6";

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
  attribution?: ModelAttribution;
}

interface ModelAttribution {
  creator: string;
  license: string;
  sourceUrl: string;
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
  matrixPrecision: MatrixPrecision;
  borderShapePrecision: BorderShapePrecision;
  approximateMerge: boolean;
  rectCover: boolean;
  outlinePolygons: boolean;
  dragMode: "orbit" | "pan";
  target: ReactVec3;
}

interface ParserOptionsState {
  targetSize: number;
  gridShift: number;
  defaultColor: string;
}

interface DomMetrics {
  measuredAt: number;
  nodeCount: number;
  polyCount: number;
}

interface GalleryPresetFile {
  file: string;
  label?: string;
  category: string;
  targetSize?: number;
  zoom?: number;
  rotX?: number;
  rotY?: number;
  attribution?: ModelAttribution;
}

function galleryFileUrl(folder: "glb" | "vox", file: string): string {
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
    attribution: input.attribution,
  };
}

const GLB_PRESET_FILES: GalleryPresetFile[] = [
  { file: "FishAnimated.glb", label: "Animated Fish", category: "Animated" },
  { file: "AnimatedMushnub.glb", label: "Animated Mushnub", category: "Animated" },
  { file: "AnimatedWizard.glb", label: "Animated Wizard", category: "Animated" },
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
  { file: "Spider.glb", category: "Animals" },
  { file: "Wolf.glb", category: "Animals" },
  { file: "Zebra.glb", category: "Animals" },
  { file: "Bicycle.glb", category: "Vehicles" },
  { file: "Dump truck.glb", label: "Dump Truck", category: "Vehicles" },
  { file: "Policecar.glb", label: "Police Car", category: "Vehicles" },
  { file: "Taxi.glb", category: "Vehicles" },
  { file: "Truck.glb", category: "Vehicles" },
  { file: "Acousticguitar.glb", label: "Acoustic Guitar", category: "Instruments" },
  { file: "Electricguitar.glb", label: "Electric Guitar", category: "Instruments" },
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
  { file: "Treasuretrunk.glb", label: "Treasure Trunk", category: "Objects" },
];

const POLY_PIZZA_PRESET_FILES: GalleryPresetFile[] = [
  {
    file: "poly-pizza/pizza-box.glb",
    label: "Pizza Box",
    category: "Food & Drink",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/PSqXX0pj5o",
      tris: 60,
    },
  },
  {
    file: "poly-pizza/cup.glb",
    label: "Cup",
    category: "Food & Drink",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/aSF8ANEIsX",
      tris: 80,
    },
  },
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
    file: "poly-pizza/chair.glb",
    label: "Chair",
    category: "Furniture & Decor",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/iMNqRzPwwe",
      tris: 216,
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
    file: "poly-pizza/barrel.glb",
    label: "Barrel",
    category: "Objects",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/orjMeJQfFD",
      tris: 412,
    },
  },
  {
    file: "poly-pizza/houseplant.glb",
    label: "Houseplant",
    category: "Environment",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/bfLOqIV5uP",
      tris: 449,
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
    file: "poly-pizza/small-building.glb",
    label: "Small Building",
    category: "Architecture",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/gyjF60t7CG",
      tris: 694,
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
    file: "poly-pizza/wolf.glb",
    label: "Wolf",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/P1gU3Qkr9r",
      tris: 1928,
    },
  },
  {
    file: "poly-pizza/bat.glb",
    label: "Bat",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/hNO9XvjlKa",
      tris: 772,
    },
  },
  {
    file: "poly-pizza/bird.glb",
    label: "Bird",
    category: "Animals",
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
    file: "poly-pizza/horse.glb",
    label: "Horse",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/F8HAAcLeBL",
      tris: 690,
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
    file: "poly-pizza/mushnub.glb",
    label: "Mushnub",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/LWKmS30Xxl",
      tris: 1200,
    },
  },
  {
    file: "poly-pizza/pig.glb",
    label: "Pig",
    category: "Animals",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/TNvG3QUFlp",
      tris: 562,
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
    file: "poly-pizza/small-building-2.glb",
    label: "Small Building",
    category: "Architecture",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/QjL4Fo9dU9",
      tris: 410,
    },
  },
  {
    file: "poly-pizza/small-watch-tower.glb",
    label: "Small Watch Tower",
    category: "Architecture",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/CygapExMf5",
      tris: 588,
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
    file: "poly-pizza/books.glb",
    label: "Books",
    category: "Objects",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/M2cJ5sVUgJ",
      tris: 124,
    },
  },
  {
    file: "poly-pizza/bucket.glb",
    label: "Bucket",
    category: "Objects",
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
    file: "poly-pizza/crate-2.glb",
    label: "Crate",
    category: "Objects",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/3VGWnZPXmG",
      tris: 784,
    },
  },
  {
    file: "poly-pizza/bottle.glb",
    label: "Bottle",
    category: "Food & Drink",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/Pc8dM9Ja4V",
      tris: 118,
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
    file: "poly-pizza/glass.glb",
    label: "Glass",
    category: "Food & Drink",
    attribution: {
      creator: "MilkAndBanana",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/3v7i0dz7Vg",
      tris: 76,
    },
  },
  {
    file: "poly-pizza/meat-patty.glb",
    label: "Meat Patty",
    category: "Food & Drink",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/2RbsQBbMGg",
      tris: 104,
    },
  },
  {
    file: "poly-pizza/mushroom-half.glb",
    label: "Mushroom Half",
    category: "Food & Drink",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/Rya1QwSsEE",
      tris: 68,
    },
  },
  {
    file: "poly-pizza/mushroom-sliced.glb",
    label: "Mushroom Sliced",
    category: "Food & Drink",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/VjFoJav3v7",
      tris: 92,
    },
  },
  {
    file: "poly-pizza/door.glb",
    label: "Door",
    category: "Furniture & Decor",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/KGt4ztcKrM",
      tris: 52,
    },
  },
  {
    file: "poly-pizza/lamp-square-floor.glb",
    label: "Lamp Square Floor",
    category: "Furniture & Decor",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/YhhExKQQCs",
      tris: 120,
    },
  },
  {
    file: "poly-pizza/light-bulb.glb",
    label: "Light bulb",
    category: "Furniture & Decor",
    attribution: {
      creator: "reelpersen",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/kDo0SbQW9Y",
      tris: 124,
    },
  },
  {
    file: "poly-pizza/red-door.glb",
    label: "Red Door",
    category: "Furniture & Decor",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/NZxf87zEEm",
      tris: 152,
    },
  },
  {
    file: "poly-pizza/shelf-small.glb",
    label: "Shelf Small",
    category: "Furniture & Decor",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/TfdgUV2RYe",
      tris: 92,
    },
  },
  {
    file: "poly-pizza/table.glb",
    label: "Table",
    category: "Furniture & Decor",
    attribution: {
      creator: "CreativeTrio",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/KndwzSWSHR",
      tris: 86,
    },
  },
  {
    file: "poly-pizza/wall-window-wide.glb",
    label: "Wall Window Wide",
    category: "Furniture & Decor",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/yRpmaYy3Wq",
      tris: 152,
    },
  },
  {
    file: "poly-pizza/window-round.glb",
    label: "Window Round",
    category: "Furniture & Decor",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/WROtq6kA7t",
      tris: 158,
    },
  },
  {
    file: "poly-pizza/bear-head-mount.glb",
    label: "Bear Head mount",
    category: "Environment",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/quLiYDFAHt",
      tris: 268,
    },
  },
  {
    file: "poly-pizza/cactus-a.glb",
    label: "Cactus A",
    category: "Environment",
    attribution: {
      creator: "Isa Lousberg",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/j8VltLwzPG",
      tris: 224,
    },
  },
  {
    file: "poly-pizza/cactus-model.glb",
    label: "Cactus Model",
    category: "Environment",
    attribution: {
      creator: "Isa Lousberg",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/o9BH8qbqfZ",
      tris: 270,
    },
  },
  {
    file: "poly-pizza/houseplant-2.glb",
    label: "Houseplant",
    category: "Environment",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/f6GPjbEgg0",
      tris: 245,
    },
  },
  {
    file: "poly-pizza/mushroom.glb",
    label: "Mushroom",
    category: "Environment",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/A2rwQyfqYG",
      tris: 80,
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
    file: "poly-pizza/rock-flat.glb",
    label: "Rock Flat",
    category: "Environment",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/CrSoV13mCU",
      tris: 214,
    },
  },
  {
    file: "poly-pizza/rock-large.glb",
    label: "Rock Large",
    category: "Environment",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/54jZKTAt5p",
      tris: 222,
    },
  },
  {
    file: "poly-pizza/rock-medium.glb",
    label: "Rock Medium",
    category: "Environment",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/s1OJ3bBzqc",
      tris: 342,
    },
  },
  {
    file: "poly-pizza/rocks.glb",
    label: "Rocks",
    category: "Environment",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/OQvi8PIZ40",
      tris: 84,
    },
  },
  {
    file: "poly-pizza/axe.glb",
    label: "Axe",
    category: "Objects",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/W0UYZPYSXf",
      tris: 76,
    },
  },
  {
    file: "poly-pizza/box.glb",
    label: "Box",
    category: "Objects",
    attribution: {
      creator: "Kay Lousberg",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/ykZ23x9d6p",
      tris: 32,
    },
  },
  {
    file: "poly-pizza/cardboard-box-closed.glb",
    label: "Cardboard Box Closed",
    category: "Objects",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/zv8NvYfT9B",
      tris: 120,
    },
  },
  {
    file: "poly-pizza/cardboard-box-open.glb",
    label: "Cardboard Box Open",
    category: "Objects",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/i1lr4yJFY0",
      tris: 120,
    },
  },
  {
    file: "poly-pizza/cardboard-boxes.glb",
    label: "Cardboard Boxes",
    category: "Objects",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/bs6ikOeTrR",
      tris: 108,
    },
  },
  {
    file: "poly-pizza/computer-screen.glb",
    label: "Computer Screen",
    category: "Objects",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/V5Qo141OcB",
      tris: 144,
    },
  },
  {
    file: "poly-pizza/crate.glb",
    label: "Crate",
    category: "Objects",
    attribution: {
      creator: "Kay Lousberg",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/yCBoU0iyOk",
      tris: 132,
    },
  },
  {
    file: "poly-pizza/empty-box.glb",
    label: "Empty Box",
    category: "Objects",
    attribution: {
      creator: "CreativeTrio",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/pZBpmjtvw8",
      tris: 76,
    },
  },
  {
    file: "poly-pizza/round-window.glb",
    label: "Round Window",
    category: "Objects",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/0U2hTU44WK",
      tris: 104,
    },
  },
  {
    file: "poly-pizza/wall-doorway.glb",
    label: "Wall Doorway",
    category: "Objects",
    attribution: {
      creator: "Kenney",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/8PcjloG3fl",
      tris: 120,
    },
  },
  {
    file: "poly-pizza/window.glb",
    label: "Window",
    category: "Objects",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/EY1zrFcme9",
      tris: 102,
    },
  },
  {
    file: "poly-pizza/window-small.glb",
    label: "Window Small",
    category: "Objects",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/n88WAcjzTv",
      tris: 132,
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
    file: "poly-pizza/rabbit-cyan-hair.glb",
    label: "Rabbit Cyan Hair",
    category: "Characters",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/RPZ9gxcFL3",
      tris: 1570,
    },
  },
  {
    file: "poly-pizza/rabbit-grey.glb",
    label: "Rabbit Grey",
    category: "Characters",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/KRnXIKJbqp",
      tris: 1570,
    },
  },
  {
    file: "poly-pizza/wizard.glb",
    label: "Wizard",
    category: "Characters",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/o87Upt5uHX",
      tris: 1674,
    },
  },
  {
    file: "poly-pizza/arrow.glb",
    label: "Arrow",
    category: "Weapons",
    attribution: {
      creator: "CreativeTrio",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/dZVjrxZdaB",
      tris: 119,
    },
  },
  {
    file: "poly-pizza/axe-2.glb",
    label: "Axe",
    category: "Weapons",
    attribution: {
      creator: "Armory_3D",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/jYnW3DNd7J",
      tris: 120,
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
  {
    file: "poly-pizza/sword-diamond.glb",
    label: "Sword Diamond",
    category: "Weapons",
    attribution: {
      creator: "Quaternius",
      license: "CC0 1.0",
      sourceUrl: "https://poly.pizza/m/WPj4nM1PFL",
      tris: 118,
    },
  },

];

const VOX_PRESET_FILES: GalleryPresetFile[] = [
  { file: "AncientCrashSite.vox", label: "Ancient Crash Site", category: "VOX", targetSize: 70, zoom: 0.35 },
  { file: "army.vox", label: "Army", category: "VOX" },
  { file: "desert.vox", label: "Desert", category: "VOX" },
  { file: "desert2.vox", label: "Desert 2", category: "VOX" },
  { file: "Garden.vox", category: "VOX" },
  { file: "Building03.vox", label: "Building 03", category: "VOX" },
  { file: "HUT.vox", label: "Hut", category: "VOX" },
  { file: "house.vox", label: "House", category: "VOX" },
  { file: "pyramid.vox", label: "Pyramid", category: "VOX" },
  { file: "skyscraper.vox", label: "Skyscraper", category: "VOX" },
  { file: "stairs.vox", label: "Stairs", category: "VOX" },
  { file: "Plane_03.vox", label: "Plane 03", category: "VOX" },
  { file: "bus.vox", label: "Bus", category: "VOX" },
  { file: "tank.vox", label: "Tank", category: "VOX" },
  { file: "arachnoid.vox", label: "Arachnoid", category: "VOX" },
  { file: "MechaGolem.vox", label: "Mecha Golem", category: "VOX" },
  { file: "mecha.vox", label: "Mecha", category: "VOX" },
  { file: "StarMarineTrooper.vox", label: "Star Marine Trooper", category: "VOX" },
  { file: "apple.vox", label: "Apple", category: "VOX" },
  { file: "dual.vox", label: "Dual", category: "VOX" },
  { file: "Treasure.vox", category: "VOX" },
  { file: "tree.vox", label: "Tree", category: "VOX" },
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
  },
  {
    id: "church",
    label: "Church (UV-mapped)",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/church.obj",
    mtlUrl: "/gallery/obj/church.mtl",
    options: { targetSize: 60, defaultColor: "#cccccc" },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "avocado",
    label: "Avocado (UV-mapped)",
    category: "Objects",
    kind: "obj",
    url: "/gallery/obj/avocado.obj",
    mtlUrl: "/gallery/obj/avocado.mtl",
    options: { targetSize: 50, defaultColor: "#cccccc" },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
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
    zoom: 0.3,
    rotX: 65,
    rotY: 45,
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
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "rock1",
    label: "Rock (UV-mapped)",
    category: "Environment",
    kind: "obj",
    url: "/gallery/obj/rock1.obj",
    mtlUrl: "/gallery/obj/rock1.mtl",
    options: { targetSize: 40, defaultColor: "#8b6f47", excludeObjects: ["Plane"] },
    zoom: 0.6,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "insurgent",
    label: "Insurgent (.gltf, embedded buffer)",
    category: "Characters",
    kind: "gltf",
    url: "/gallery/glb/insurgent.gltf",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "apoc-car",
    label: "Apocalypse Car (GLB)",
    category: "Vehicles",
    kind: "glb",
    url: "/gallery/glb/apocalypse/car.glb",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "apoc-barrel",
    label: "Apocalypse Barrel (GLB)",
    category: "Objects",
    kind: "glb",
    url: "/gallery/glb/apocalypse/barrel.glb",
    options: { targetSize: 50 },
    zoom: 0.5,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "apoc-wall",
    label: "Apocalypse Wall (GLB)",
    category: "Architecture",
    kind: "glb",
    url: "/gallery/glb/apocalypse/wall_1.glb",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "apoc-spike",
    label: "Spike Barricade (GLB)",
    category: "Objects",
    kind: "glb",
    url: "/gallery/glb/apocalypse/wooden_spike_barricade.glb",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "ranger",
    label: "Ranger (GLB, UV-mapped)",
    category: "Characters",
    kind: "glb",
    url: "/gallery/glb/ranger.glb",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
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
    kind: "obj",
    url: "/gallery/obj/saucer.obj",
    options: { targetSize: 60, defaultColor: "#94a3b8" },
    zoom: 0.2,
    rotX: 67,
    rotY: 42.3,
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
  ...GLB_PRESET_FILES.map(glbPreset),
  ...POLY_PIZZA_PRESET_FILES.map(glbPreset),
  ...VOX_PRESET_FILES.map(voxPreset),
];

const PRESET_PICKER_ITEMS = PRESETS.map(({ id, label, category }) => ({
  id,
  label,
  category,
}));

const DEFAULT_SCENE: SceneOptionsState = {
  renderer: "vanilla",
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
  matrixPrecision: "exact",
  borderShapePrecision: "exact",
  approximateMerge: false,
  rectCover: false,
  outlinePolygons: false,
  dragMode: "orbit",
  target: [0, 0, 0],
};

const APPROXIMATE_MERGE_BUDGET: GeometryNormalizeOptions = {
  maxAngleDeg: 15,
  maxPlaneDisplacement: 0.35,
  maxBoundaryDisplacement: 0.075,
  isolatedPairs: true,
};

const DEFAULT_PARSER: ParserOptionsState = {
  targetSize: 60,
  gridShift: 1,
  defaultColor: "#8b95a1",
};

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
  polyCount: 0,
};

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function formatMs(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

function atlasScaleForQuality(quality: TextureQuality): PolySceneOptions["atlasScale"] {
  switch (quality) {
    case "auto":
      return "auto";
    case "draft":
      return 0.25;
    case "balanced":
      return 0.75;
    case "full":
    default:
      return 1;
  }
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
    const parsed = parseObj(objText, {
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
    const finalPolys = preprocessModelPolygons(parsed.polygons, false);
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
    const finalPolys = preprocessModelPolygons(parsed.polygons, false);
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

  const parsed = parseGltf(buf, {
    ...mergeParserOptions(model.options, parser),
    baseUrl: new URL(model.url, window.location.href).href,
  });
  const finalPolys = preprocessModelPolygons(parsed.polygons, false);
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

function measureDom(root: HTMLElement | null): DomMetrics {
  if (!root) return EMPTY_METRICS;
  const polyEls = Array.from(root.querySelectorAll<HTMLElement>(".polycss-scene i, .polycss-scene b, .polycss-scene s"));
  return {
    measuredAt: performance.now(),
    nodeCount: root.querySelectorAll("*").length,
    polyCount: polyEls.length,
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

function matrixPrecisionDecimals(precision: MatrixPrecision): number | null {
  if (precision === "exact") return null;
  return Number(precision);
}

function roundDecimalString(value: string, decimals: number): string {
  const next = Number(value).toFixed(decimals).replace(/\.?0+$/, "");
  return Object.is(Number(next), -0) ? "0" : next;
}

function applyDebugMatrixPrecision(root: HTMLElement | null, precision: MatrixPrecision): void {
  if (!root) return;
  const decimals = matrixPrecisionDecimals(precision);
  if (decimals === null) return;
  const faces = root.querySelectorAll<HTMLElement>(".polycss-scene i, .polycss-scene b, .polycss-scene s");
  for (const face of faces) {
    const current = face.style.transform;
    if (!current.includes("matrix3d(")) continue;
    const rounded = roundMatrix3dValue(current, decimals);
    if (current !== rounded) face.style.transform = rounded;
  }
}

function applyDebugBorderShapePrecision(root: HTMLElement | null, precision: BorderShapePrecision): void {
  if (!root) return;
  const decimals = matrixPrecisionDecimals(precision);
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

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="dn-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output>{format(value)}</output>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="dn-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) {
  return (
    <div className={`dn-toolbar__kpi${tone ? ` dn-toolbar__kpi--${tone}` : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function ControlPanel({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="dn-panel dn-panel--details" open={defaultOpen}>
      <summary>
        <h2>{title}</h2>
      </summary>
      <div className="dn-panel__body">{children}</div>
    </details>
  );
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
  helperScale,
  helperTarget,
  mergePolygonsForMesh,
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
}: {
  polygons: Polygon[];
  options: SceneOptionsState;
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  showAxes: boolean;
  showLight: boolean;
  helperScale: number;
  helperTarget: Vec3;
  mergePolygonsForMesh: boolean;
  animationKey?: string;
  animationFrameFactory?: (timeSeconds: number) => Polygon[];
  onBuild: (ms: number) => void;
  onCameraChange?: (camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 }) => void;
  enableSelection?: boolean;
  meshId?: string;
  onSelectionChange?: (selectedIds: string[]) => void;
  gizmoMode?: "translate" | "rotate" | "scale";
  enableHover?: boolean;
  onHoverChange?: (id: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const controlsRef = useRef<ControlsHandle | null>(null);
  const meshHandleRef = useRef<MeshHandle | null>(null);
  const axesHandleRef = useRef<MeshHandle | null>(null);
  const lightHandleRef = useRef<MeshHandle | null>(null);
  const selectionRef = useRef<SelectionHandle | null>(null);
  const transformControlsRef = useRef<TransformControlsHandle | null>(null);
  const onBuildRef = useRef(onBuild);
  onBuildRef.current = onBuild;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onHoverChangeRef = useRef(onHoverChange);
  onHoverChangeRef.current = onHoverChange;

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
      atlasScale: atlasScaleForQuality(options.textureQuality),
    };
    const scene = createPolyScene(host, sceneOptions);
    sceneRef.current = scene;
    meshHandleRef.current = scene.add({
      polygons,
      objectUrls: [],
      warnings: [],
      dispose: () => {},
    }, { merge: mergePolygonsForMesh, stableDom: !!animationFrameFactory, id: meshId });
    return () => {
      // Tear controls down BEFORE destroying the scene — otherwise the
      // controls' rAF tick could fire one more time against a stale handle.
      controlsRef.current?.destroy();
      controlsRef.current = null;
      axesHandleRef.current = null;
      lightHandleRef.current = null;
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
    animationFrameFactory,
  ]);

  // Effect 1.5 — replace geometry on the existing mesh. This is the path
  // used by animated GLB playback.
  useEffect(() => {
    const handle = meshHandleRef.current;
    if (!handle) return;
    const started = performance.now();
    handle.setPolygons(polygons, {
      merge: mergePolygonsForMesh,
      stableDom: !!animationFrameFactory,
    });
    requestAnimationFrame(() =>
      onBuildRef.current(performance.now() - started),
    );
  }, [polygons, mergePolygonsForMesh, animationFrameFactory]);

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
    // the new SceneHandle whenever the scene tears down + rebuilds.
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    animationFrameFactory,
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
    animationFrameFactory,
  ]);

  useEffect(() => {
    if (!animationFrameFactory || !animationKey) return;
    let raf = 0;
    const started = performance.now();

    const tick = (now: number) => {
      const handle = meshHandleRef.current;
      if (handle) {
        handle.setPolygons(animationFrameFactory((now - started) / 1000), {
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

  // Effect 2.5 — vanilla controls. The React renderer wires interactive +
  // animate through <PolyCamera>; the vanilla path uses createPolyControls.
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
    if (!controlsRef.current) {
      const controls = createPolyControls(scene, {
        drag: options.interactive,
        wheel: options.interactive,
        mode: options.dragMode,
        animate: options.animate ? { speed: 0.3, axis: "y", pauseOnInteraction: true } : false,
      });
      // Sync the camera back to React state ONCE per gesture (pointerup /
      // wheel-idle) instead of every move. Per-frame React renders during
      // a drag re-fire Effect 2 below, which re-applies directionalLight /
      // ambientLight on every render → cascade walk competes with the
      // drag's compositor frame in dynamic-lighting mode → flicker.
      // Sliders snap to position on release; the camera moving IS the
      // visual feedback during drag.
      controls.addEventListener("end", (e) => {
        onCameraChangeRef.current?.(e.camera);
      });
      controlsRef.current = controls;
    } else {
      controlsRef.current.update({
        drag: options.interactive,
        wheel: options.interactive,
        mode: options.dragMode,
        animate: options.animate ? { speed: 0.3, axis: "y", pauseOnInteraction: true } : false,
      });
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
        polygons: octahedronPolygons([0, 0, 0], helperScale * 0.05, swatch),
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
  const [initialPreset] = useState(randomPreset);
  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(() => sceneDefaultsFor(initialPreset));
  const [parserOptions, setParserOptions] = useState<ParserOptionsState>(() => parserStateFor(initialPreset));
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [reactAnimatedPolygons, setReactAnimatedPolygons] = useState<Polygon[] | null>(null);
  const [metrics, setMetrics] = useState<DomMetrics>(EMPTY_METRICS);
  const [vanillaBuildMs, setVanillaBuildMs] = useState(0);
  const disposeRef = useRef<(() => void) | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Selection + drag state for the React renderer's <PolyMesh> wrapper.
  // Lives at this level so a model swap can reset both — the gizmo
  // shouldn't follow a stale handle, and a freshly loaded mesh should
  // sit at its authored origin.
  const meshRef = useRef<PolyMeshHandle>(null);
  const [meshPosition, setMeshPosition] = useState<ReactVec3>([0, 0, 0]);
  const [meshRotation, setMeshRotation] = useState<ReactVec3>([0, 0, 0]);
  const [gizmoMode, setGizmoMode] = useState<"translate" | "rotate" | "scale">("translate");
  const [selectedMeshes, setSelectedMeshes] = useState<PolyMeshHandle[]>([]);
  // Mirror of PolyTransformControls' drag state — three.js convention is to
  // disable OrbitControls while a transform gizmo is being dragged so
  // the camera doesn't co-rotate. Same idea here: gate PolyControls'
  // drag/wheel on this flag.
  const [gizmoDragging, setGizmoDragging] = useState(false);
  // Hover state for the mesh — wired the r3f / three.js way via
  // onPointerOver / onPointerOut on <PolyMesh>. Demonstrates the
  // mesh-event API (events.ts → InteractionProps) — same shape as
  // r3f, no raycasting needed because polycss uses DOM events.
  const [hoveredMeshId, setHoveredMeshId] = useState<string | null>(null);
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

  const updateParser = useCallback((partial: Partial<ParserOptionsState>) => {
    setParserOptions((current) => ({ ...current, ...partial }));
  }, []);

  const selectedPreset = PRESETS.find((preset) => preset.id === presetId) ?? PRESETS[0];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const run = async () => {
      try {
        disposeRef.current?.();
        disposeRef.current = null;
        const next = await loadPresetModel(selectedPreset, parserOptions);
        if (cancelled) {
          next.dispose();
          return;
        }
        disposeRef.current = next.dispose;
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
  }, [selectedPreset, parserOptions]);

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
  const atlasScale = atlasScaleForQuality(sceneOptions.textureQuality);

  const animationClips = loaded?.animation?.clips ?? [];
  const activeAnimation = useMemo(
    () => animationClips.find((clip) => String(clip.index) === selectedAnimation) ?? null,
    [animationClips, selectedAnimation],
  );
  useEffect(() => {
    setReactAnimatedPolygons(null);
    if (!loaded?.animation || !activeAnimation || sceneOptions.renderer !== "react") return;
    let raf = 0;
    const started = performance.now();

    const tick = (now: number) => {
      setReactAnimatedPolygons(loaded.animation!.sample(activeAnimation.index, (now - started) / 1000));
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
    if (activeAnimation) {
      return sceneOptions.renderer === "react" && reactAnimatedPolygons
        ? reactAnimatedPolygons
        : loaded.rawPolygons;
    }
    const base = sceneOptions.approximateMerge
      ? preprocessModelPolygons(loaded.rawPolygons, APPROXIMATE_MERGE_BUDGET)
      : loaded.polygons;
    if (!sceneOptions.rectCover || sceneOptions.approximateMerge) return base;
    return coverPlanarPolygons(base, {
      minGroupPolygons: 2,
      maxCandidateAxes: 24,
    });
  }, [
    loaded,
    sceneOptions.approximateMerge,
    sceneOptions.rectCover,
    activeAnimation,
    sceneOptions.renderer,
    reactAnimatedPolygons,
  ]);

  const scenePolygons = modelPolygons;

  const helperBbox = useMemo(() => {
    const polygons = modelPolygons;
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
  }, [modelPolygons]);

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
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setMetrics(measureDom(viewportRef.current));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [scenePolygons, sceneOptions, vanillaBuildMs]);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      applyDebugMatrixPrecision(root, sceneOptions.matrixPrecision);
      applyDebugBorderShapePrecision(root, sceneOptions.borderShapePrecision);
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
      sceneOptions.autoCenter,
      sceneOptions.perspective === false ? "none" : sceneOptions.perspective,
      loaded?.label ?? "none",
      activeAnimation ? `${selectedAnimation}:${loaded?.label ?? ""}` : "static",
    ].join(":"),
    [
      sceneOptions.renderer,
      sceneOptions.matrixPrecision,
      sceneOptions.borderShapePrecision,
      sceneOptions.textureLighting,
      sceneOptions.textureQuality,
      sceneOptions.autoCenter,
      sceneOptions.perspective,
      loaded?.label,
      activeAnimation,
      selectedAnimation,
    ],
  );

  const resetToPreset = useCallback((id: string) => {
    const next = PRESETS.find((preset) => preset.id === id);
    setPresetId(id);
    setSelectedAnimation("");
    setReactAnimatedPolygons(null);
    if (!next) return;
    setParserOptions((current) => ({
      ...current,
      ...parserDefaultsFor(next),
    }));
    setSceneOptions((current) => ({
      ...current,
      zoom: next.zoom ?? current.zoom,
      rotX: next.rotX ?? current.rotX,
      rotY: next.rotY ?? current.rotY,
    }));
  }, []);

  const budgetTone =
    metrics.polyCount > 2500
      ? "warn"
      : metrics.polyCount < 900
        ? "good"
        : undefined;
  const activeAttribution = selectedPreset.attribution;

  return (
    <div className="dn-root">
      <aside className="dn-sidebar dn-sidebar--left">
        <ControlPanel title="Model">
          <RangeControl
            label="Target"
            value={parserOptions.targetSize}
            min={10}
            max={120}
            step={1}
            onChange={(value) => updateParser({ targetSize: value })}
            format={(value) => value.toFixed(0)}
          />
          <RangeControl
            label="Shift"
            value={parserOptions.gridShift}
            min={0}
            max={8}
            step={0.25}
            onChange={(value) => updateParser({ gridShift: value })}
            format={(value) => value.toFixed(2)}
          />
          <label className="dn-field dn-field--color">
            <span>Fallback</span>
            <input
              type="color"
              value={parserOptions.defaultColor}
              onChange={(event) => updateParser({ defaultColor: event.currentTarget.value })}
            />
            <code>{parserOptions.defaultColor}</code>
          </label>
          <label className="dn-field">
            <span>Animation</span>
            <select
              value={selectedAnimation}
              onChange={(event) => {
                setSelectedAnimation(event.currentTarget.value);
                setReactAnimatedPolygons(null);
              }}
              disabled={animationClips.length === 0}
            >
              <option value="">None</option>
              {animationClips.map((clip) => (
                <option key={clip.index} value={String(clip.index)}>
                  {clip.name} ({clip.duration.toFixed(2)}s)
                </option>
              ))}
            </select>
          </label>
          <Toggle
            label="Approx merge"
            checked={sceneOptions.approximateMerge}
            onChange={(value) => updateScene({ approximateMerge: value })}
            disabled={!!activeAnimation}
          />
          <Toggle
            label="Rect cover"
            checked={sceneOptions.rectCover}
            onChange={(value) => updateScene({ rectCover: value })}
            disabled={sceneOptions.approximateMerge}
          />
          {loading && <p className="dn-note">Loading model...</p>}
          {loadError && <p className="dn-note dn-note--error">{loadError}</p>}
        </ControlPanel>

        <ControlPanel title="Interaction">
          <Toggle label="Interactive" checked={sceneOptions.interactive} onChange={(value) => updateScene({ interactive: value })} />
          <Toggle label="Auto rotate" checked={sceneOptions.animate} onChange={(value) => updateScene({ animate: value })} />
          <Toggle
            label="Selection"
            checked={sceneOptions.selection}
            onChange={(value) => updateScene({ selection: value })}
          />
          <Toggle
            label="Hover effects"
            checked={sceneOptions.hoverEffects}
            onChange={(value) => updateScene({ hoverEffects: value })}
          />
          <div className="dn-field dn-field--segment">
            <span>Gizmo</span>
            <div className="dn-segment">
              {(["translate", "rotate"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={gizmoMode === m ? "active" : ""}
                  onClick={() => setGizmoMode(m)}
                  disabled={!sceneOptions.selection}
                  title={!sceneOptions.selection ? "Enable Selection to use the gizmo" : undefined}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </ControlPanel>

        <ControlPanel title="Renderer" defaultOpen>
          <div className="dn-field dn-field--segment">
            <span>Renderer</span>
            <div className="dn-segment">
              <button
                type="button"
                className={sceneOptions.renderer === "react" ? "active" : ""}
                onClick={() => updateScene({ renderer: "react" })}
              >
                React
              </button>
              <button
                type="button"
                className={sceneOptions.renderer === "vanilla" ? "active" : ""}
                onClick={() => updateScene({ renderer: "vanilla" })}
              >
                Vanilla
              </button>
            </div>
          </div>
          <div className="dn-field dn-field--segment">
            <span>Texture</span>
            <div className="dn-segment">
              {(["baked", "dynamic"] as PolyTextureLightingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={sceneOptions.textureLighting === mode ? "active" : ""}
                  onClick={() => updateScene({ textureLighting: mode })}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <label className="dn-field">
            <span>Quality</span>
            <select
              value={sceneOptions.textureQuality}
              onChange={(event) => updateScene({ textureQuality: event.currentTarget.value as TextureQuality })}
            >
              <option value="auto">Auto</option>
              <option value="full">Full - 1x atlas</option>
              <option value="balanced">Balanced - 0.75x</option>
              <option value="draft">Draft - 0.25x</option>
            </select>
          </label>
          <label className="dn-field">
            <span>Matrix</span>
            <select
              value={sceneOptions.matrixPrecision}
              onChange={(event) => updateScene({ matrixPrecision: event.currentTarget.value as MatrixPrecision })}
            >
              <option value="exact">Exact</option>
              <option value="2">2 decimals</option>
              <option value="3">3 decimals</option>
              <option value="4">4 decimals</option>
              <option value="5">5 decimals</option>
              <option value="6">6 decimals</option>
            </select>
          </label>
          <label className="dn-field">
            <span>Border shape</span>
            <select
              value={sceneOptions.borderShapePrecision}
              onChange={(event) => updateScene({ borderShapePrecision: event.currentTarget.value as BorderShapePrecision })}
            >
              <option value="exact">Exact</option>
              <option value="2">2 decimals</option>
              <option value="3">3 decimals</option>
              <option value="4">4 decimals</option>
              <option value="5">5 decimals</option>
              <option value="6">6 decimals</option>
            </select>
          </label>
          <Toggle label="Auto center" checked={sceneOptions.autoCenter} onChange={(value) => updateScene({ autoCenter: value })} />
          <Toggle label="Polygon outline" checked={sceneOptions.outlinePolygons} onChange={(value) => updateScene({ outlinePolygons: value })} />
          <Toggle label="Axes" checked={sceneOptions.showAxes} onChange={(value) => updateScene({ showAxes: value })} />
        </ControlPanel>

        <ControlPanel title="Camera">
          <div className="dn-segment" style={{ marginTop: 0 }}>
            <button
              type="button"
              onClick={() => updateScene({
                zoom: selectedPreset.zoom ?? 0.35,
                rotX: selectedPreset.rotX ?? 65,
                rotY: selectedPreset.rotY ?? 45,
                target: [0, 0, 0],
              })}
            >
              Reset camera
            </button>
          </div>
          <label className="dn-field dn-field--segment">
            <span>Drag</span>
            <div className="dn-segment">
              {(["orbit", "pan"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={sceneOptions.dragMode === m ? "active" : ""}
                  onClick={() => updateScene({ dragMode: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          </label>
          <RangeControl label="Zoom" value={sceneOptions.zoom} min={0.05} max={2.5} step={0.01} onChange={(value) => updateScene({ zoom: value })} format={(value) => value.toFixed(2)} />
          <RangeControl label="Rot X" value={sceneOptions.rotX} min={0} max={100} step={1} onChange={(value) => updateScene({ rotX: value })} format={(value) => `${value.toFixed(0)} deg`} />
          <RangeControl label="Rot Y" value={sceneOptions.rotY} min={0} max={360} step={1} onChange={(value) => updateScene({ rotY: value })} format={(value) => `${value.toFixed(0)} deg`} />
          <RangeControl label="Target X" value={sceneOptions.target[0]} min={-50} max={50} step={0.1} onChange={(value) => updateScene({ target: [value, sceneOptions.target[1], sceneOptions.target[2]] })} format={(value) => value.toFixed(2)} />
          <RangeControl label="Target Y" value={sceneOptions.target[1]} min={-50} max={50} step={0.1} onChange={(value) => updateScene({ target: [sceneOptions.target[0], value, sceneOptions.target[2]] })} format={(value) => value.toFixed(2)} />
          <RangeControl label="Target Z" value={sceneOptions.target[2]} min={-50} max={50} step={0.1} onChange={(value) => updateScene({ target: [sceneOptions.target[0], sceneOptions.target[1], value] })} format={(value) => value.toFixed(2)} />
          <div className="dn-field dn-field--segment">
            <span>Camera</span>
            <div className="dn-segment">
              {(["perspective", "orthographic"] as const).map((m) => {
                const active = m === "perspective" ? sceneOptions.perspective !== false : sceneOptions.perspective === false;
                return (
                  <button
                    key={m}
                    type="button"
                    className={active ? "active" : ""}
                    onClick={() => updateScene({ perspective: m === "perspective" ? 8000 : false })}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
          {sceneOptions.perspective !== false && (
            <label className="dn-field">
              <span>Perspective px</span>
              <select
                value={String(sceneOptions.perspective)}
                onChange={(event) => updateScene({ perspective: Number(event.currentTarget.value) })}
              >
                <option value="1000">1000px</option>
                <option value="2000">2000px</option>
                <option value="4000">4000px</option>
                <option value="8000">8000px</option>
              </select>
            </label>
          )}
        </ControlPanel>

        <ControlPanel title="Lights">
          <Toggle label="Light helper" checked={sceneOptions.showLight} onChange={(value) => updateScene({ showLight: value })} />
          <RangeControl label="Azimuth" value={sceneOptions.lightAzimuth} min={0} max={360} step={1} onChange={(value) => updateScene({ lightAzimuth: value })} format={(value) => `${value.toFixed(0)} deg`} />
          <RangeControl label="Elev." value={sceneOptions.lightElevation} min={-90} max={90} step={1} onChange={(value) => updateScene({ lightElevation: value })} format={(value) => `${value.toFixed(0)} deg`} />
          <RangeControl label="Key" value={sceneOptions.lightIntensity} min={0} max={2} step={0.05} onChange={(value) => updateScene({ lightIntensity: value })} format={(value) => value.toFixed(2)} />
          <label className="dn-field dn-field--color">
            <span>Key color</span>
            <input type="color" value={sceneOptions.lightColor} onChange={(event) => updateScene({ lightColor: event.currentTarget.value })} />
            <code>{sceneOptions.lightColor}</code>
          </label>
          <RangeControl label="Ambient" value={sceneOptions.ambientIntensity} min={0} max={2} step={0.05} onChange={(value) => updateScene({ ambientIntensity: value })} format={(value) => value.toFixed(2)} />
          <label className="dn-field dn-field--color">
            <span>Amb. color</span>
            <input type="color" value={sceneOptions.ambientColor} onChange={(event) => updateScene({ ambientColor: event.currentTarget.value })} />
            <code>{sceneOptions.ambientColor}</code>
          </label>
        </ControlPanel>
      </aside>

      <main className="dn-main">
        <div className="dn-toolbar">
          <div className="dn-toolbar__model">
            <b>{loaded?.label ?? "No model"}</b>
            <span className="dn-toolbar__summary">
              {loaded
                ? `${loaded.kind.toUpperCase()} - ${formatNumber(loaded.sourcePolygons)} source / ${formatNumber(modelPolygons.length)} merged polygons`
                : "Drop a model or pick a preset"}
              {hoveredMeshId && <> · hover: <code>{hoveredMeshId}</code></>}
              {(selectedMeshes.length > 0 || vanillaSelectedIds.length > 0) && (
                <> · selected: <code>{
                  selectedMeshes.length > 0
                    ? selectedMeshes.map((m) => m.id ?? "?").join(", ")
                    : vanillaSelectedIds.join(", ")
                }</code></>
              )}
            </span>
            {activeAttribution && (
              <span className="dn-toolbar__source">
                by {activeAttribution.creator}
                {typeof activeAttribution.tris === "number" ? ` - ${formatNumber(activeAttribution.tris)} tris` : ""}
                {" - "}
                {activeAttribution.license}
                {" - "}
                <a href={activeAttribution.sourceUrl} target="_blank" rel="noreferrer">
                  Poly Pizza
                </a>
              </span>
            )}
          </div>
          <div className="dn-toolbar__kpis" aria-label="Performance KPIs">
            <StatsJsPanel />
            {sceneOptions.renderer === "vanilla" && (
              <Kpi label="Build" value={formatMs(vanillaBuildMs)} />
            )}
            <Kpi label="DOM" value={formatNumber(metrics.nodeCount)} tone={budgetTone} />
            <Kpi label="Polys" value={formatNumber(metrics.polyCount)} tone={budgetTone} />
          </div>
        </div>

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
              helperScale={helperScale}
              helperTarget={helperTarget}
              mergePolygonsForMesh={!activeAnimation}
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
                polygons={sceneOptions.selection ? [] : scenePolygons}
                centerPolygons={sceneOptions.selection ? scenePolygons : undefined}
                autoCenter={sceneOptions.autoCenter}
                directionalLight={directionalLight}
                ambientLight={ambientLight}
                textureLighting={sceneOptions.textureLighting}
                atlasScale={atlasScale}
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
                          ? "is-hovered"
                          : undefined
                      }
                      style={sceneOptions.hoverEffects ? { cursor: "pointer" } : undefined}
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
      </main>

      <aside className="dn-sidebar dn-sidebar--right">
        <section className="dn-panel dn-panel--model-selector">
          <h2>Gallery</h2>
          <div className="dn-preset-picker">
            <ModelPicker
              items={PRESET_PICKER_ITEMS}
              value={presetId}
              onChange={resetToPreset}
              searchPlaceholder="Search presets"
            />
          </div>
        </section>
      </aside>
    </div>
  );
}
