import type { ModelAttribution } from "../types";

export const QUATERNIUS_ANIMATED_FISH_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://quaternius.itch.io/lowpoly-animated-fish",
};

export const QUATERNIUS_ANIMATED_MONSTERS_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://quaternius.itch.io/lowpoly-animated-monsters",
};

export const QUATERNIUS_EASY_ENEMIES_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://quaternius.itch.io/animated-easy-enemies",
};

export const KHRONOS_FOX_ATTRIBUTION: ModelAttribution = {
  creator: "PixelMannen / tomkranis",
  license: "CC0 1.0 / CC-BY 4.0",
  sourceUrl: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox",
  tris: 576,
};

export const KHRONOS_AVOCADO_ATTRIBUTION: ModelAttribution = {
  creator: "Microsoft",
  license: "CC0 1.0",
  sourceUrl: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado",
  tris: 682,
};

export const QUATERNIUS_ULTIMATE_SPACESHIPS_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://quaternius.com/packs/ultimatespaceships.html",
};

export const PROJECT_CHRONO_OFFROAD_ATTRIBUTION: ModelAttribution = {
  creator: "Project Chrono Development Team",
  license: "BSD-3-Clause",
  sourceUrl: "https://github.com/projectchrono/chrono/tree/main/data/sensor/offroad",
};

export const WEBXR_CAVE_BAT_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "CC-BY 3.0",
  sourceUrl: "https://github.com/immersive-web/webxr-samples/blob/main/media/gltf/cave/ATTRIBUTION.md",
};

export const KENNEY_MINIGOLF_ATTRIBUTION: ModelAttribution = {
  creator: "Kenney",
  license: "CC0 1.0",
  sourceUrl: "https://kenney.nl/assets/minigolf-kit",
};

export const KENNEY_CITY_KIT_ATTRIBUTION: ModelAttribution = {
  creator: "Kenney",
  license: "CC0 1.0",
  sourceUrl: "https://poly.pizza/bundle/City-Kit-0CkvGrBJ0u",
};

export const KANGAROOZ_STING_ATTRIBUTION: ModelAttribution = {
  creator: "KangaroOz 3D",
  license: "CC-BY 4.0",
  sourceUrl: "https://sketchfab.com/3d-models/sting-sword-lowpoly-c4f80dfbb61745d6807dd511d3e74fd4",
};

export const GOOGLE_POLY_AMBER_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "CC-BY 2.0",
  sourceUrl: "https://github.com/blackspotbear/amber/blob/master/demo/README.md",
};

export const GOOGLE_POLY_VIDEOLAB_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "CC-BY 3.0",
  sourceUrl: "https://github.com/keijiro/VideolabTest/blob/master/README.md",
};

export const GOOGLE_POLY_FLYING_SAUCER_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "Creative Commons Attribution",
  sourceUrl: "https://poly.pizza/m/6hu2h8v78mO",
};

export const GOOGLE_POLY_ASTRONAUT_ATTRIBUTION: ModelAttribution = {
  creator: "Poly by Google",
  license: "CC-BY",
  sourceUrl: "https://modelviewer.dev/examples/augmentedreality/",
  tris: 3208,
};

export const POLY_PIZZA_DUCK_ATTRIBUTION: ModelAttribution = {
  creator: "jeremy",
  license: "CC-BY 3.0",
  sourceUrl: "https://poly.pizza/m/2KHEgw1ztVI",
};

export const POLY_PIZZA_SAXOPHONE_ATTRIBUTION: ModelAttribution = {
  creator: "jeremy",
  license: "CC-BY 3.0",
  sourceUrl: "https://poly.pizza/m/6A2UAKdCNy7",
  tris: 812,
};

export const QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION: ModelAttribution = {
  creator: "Quaternius",
  license: "CC0 1.0",
  sourceUrl: "https://poly.pizza/bundle/Medieval-Village-Pack-NsHhjhlrfY",
};

export const POLY_PIZZA_CITY_PACK_URL = "https://poly.pizza/bundle/City-Pack-kJqRAIGsw0";

export function polyPizzaCityPackAttribution(creator: string, license: string): ModelAttribution {
  return {
    creator,
    license,
    sourceUrl: POLY_PIZZA_CITY_PACK_URL,
  };
}

export function polyPizzaAttribution(
  creator: string,
  publicId: string,
  license = "Creative Commons Attribution",
  tris?: number,
): ModelAttribution {
  return {
    creator,
    license,
    sourceUrl: `https://poly.pizza/m/${publicId}`,
    ...(typeof tris === "number" ? { tris } : {}),
  };
}

export function thingiverseAttribution(
  creator: string,
  thingId: number,
  tris: number,
  license = "Creative Commons - Attribution",
): ModelAttribution {
  return {
    creator,
    license,
    sourceUrl: `https://www.thingiverse.com/thing:${thingId}`,
    tris,
  };
}

export const PARFAITUWU_TREE_ATTRIBUTION = polyPizzaAttribution("ParfaitUwU", "MSuchZNT2G");

export function polyPizzaJeremyAttribution(publicId: string): ModelAttribution {
  return {
    creator: "jeremy",
    license: "CC-BY 3.0",
    sourceUrl: `https://poly.pizza/m/${publicId}`,
  };
}

export const MINI_MIKES_METRO_MINIS_ATTRIBUTION: ModelAttribution = {
  creator: "Mike Judge",
  license: "CC-BY 4.0",
  sourceUrl: "https://github.com/mikelovesrobots/mmmm",
};

export const MONOGON_ANCIENT_ENVIRONMENT_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-ancient-environment",
};

export const MONOGON_TINY_VOXEL_DUNGEON_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/tinyvoxeldungeon",
};

export const MONOGON_DESERT_TOWN_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-desert-town",
};

export const MONOGON_VOXEL_PLANE_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-plane",
};

export const MONOGON_VOXEL_MECHAS_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-mechas",
};

export const MONOGON_VOXEL_SPACESHIPS_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/voxel-spaceships",
};

export const MONOGON_COUNTRY_SIDE_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/counrty-side",
};

export const MONOGON_CYBERPUNK_CITY_ATTRIBUTION: ModelAttribution = {
  creator: "monogon / Max Parata",
  license: "CC-BY-ND 4.0",
  sourceUrl: "https://maxparata.itch.io/cyberpunkcity-monogon",
};

export const ATOMIC_REALM_POST_APOCALYPTIC_ATTRIBUTION: ModelAttribution = {
  creator: "Atomic Realm",
  license: "custom license, attribution required",
  sourceUrl: "https://atomicrealm.itch.io/post-apocalyptic-world",
};

export const SONA_SAR_VOXEL_ANIMALS_ITEMS_ATTRIBUTION: ModelAttribution = {
  creator: "SonaSar",
  license: "personal/commercial use allowed",
  sourceUrl: "https://sona-sar.itch.io/voxel-animals-items-pack-free-assets",
};

export const MAGICAVOXEL_TEST_MODELS_ATTRIBUTION: ModelAttribution = {
  creator: "ephtracy / MagicaVoxel",
  sourceUrl: "https://github.com/ephtracy/voxel-model",
};

export const OPENGAMEART_VOXEL_BUILDINGS_ATTRIBUTION: ModelAttribution = {
  creator: "mehrasaur",
  license: "CC0 1.0",
  sourceUrl: "https://opengameart.org/content/voxel-buildings",
};

export const OPENHV_VOXELS_ATTRIBUTION: ModelAttribution = {
  creator: "OpenHV contributors",
  license: "CC-BY-SA 4.0",
  sourceUrl: "https://github.com/Dzierzan/OpenHV/tree/master-placeholder/sources/voxels",
};

export const FLOOOH_VOXEL_DATA_ATTRIBUTION: ModelAttribution = {
  creator: "Andre Weissflog",
  license: "MIT",
  sourceUrl: "https://github.com/floooh/voxel-data",
};

export const UTAH_TEAPOT_ATTRIBUTION: ModelAttribution = {
  creator: "Martin Newell / University of Utah",
  sourceUrl: "https://graphics.cs.utah.edu/teapot/",
};

export const PRIMITIVE_ATTRIBUTION: ModelAttribution = {
  creator: "Built-in primitive",
  sourceUrl: "https://github.com/apresmoi/glyphcss",
};

export function openGameArtAttribution(
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

export function quaterniusAttribution(sourceUrl: string, tris: number): ModelAttribution {
  return {
    creator: "Quaternius",
    license: "CC0 1.0",
    sourceUrl,
    tris,
  };
}

export function nasa3dAttribution(
  creator: string,
  sourceUrl: string,
  tris: number,
): ModelAttribution {
  return {
    creator,
    license: "NASA Images and Media Usage Guidelines",
    sourceUrl,
    tris,
  };
}

export function smithsonianOpenAccessAttribution(sourceUrl: string, tris: number): ModelAttribution {
  return {
    creator: "Smithsonian Institution",
    license: "Public domain / CC0",
    sourceUrl,
    tris,
  };
}

export const GLB_PRESET_ATTRIBUTIONS: Record<string, ModelAttribution> = {
  "FishAnimated.glb": QUATERNIUS_ANIMATED_FISH_ATTRIBUTION,
  "ClownfishAnimated.glb": QUATERNIUS_ANIMATED_FISH_ATTRIBUTION,
  "AnimatedMushnub.glb": QUATERNIUS_ANIMATED_MONSTERS_ATTRIBUTION,
  "AnimatedSnake.glb": QUATERNIUS_EASY_ENEMIES_ATTRIBUTION,
  "AnimatedWizard.glb": QUATERNIUS_ANIMATED_MONSTERS_ATTRIBUTION,
  "Bat.glb": WEBXR_CAVE_BAT_ATTRIBUTION,
  "Bear.glb": polyPizzaJeremyAttribution("evjB26aGfTh"),
  "Cat.glb": polyPizzaJeremyAttribution("4Pp1CY3bC43"),
  "Cheetah.glb": polyPizzaJeremyAttribution("ew0sr-amXFo"),
  "Deer.glb": polyPizzaJeremyAttribution("fAVxGd9dP21"),
  "Dinosaur.glb": polyPizzaJeremyAttribution("5iV5SPhBu26"),
  "Dog.glb": polyPizzaJeremyAttribution("a0GNnW8q2IH"),
  "Dolphin.glb": GOOGLE_POLY_AMBER_ATTRIBUTION,
  "Dragon.glb": polyPizzaJeremyAttribution("3ZuMS3IRb0C"),
  "Duck.glb": POLY_PIZZA_DUCK_ATTRIBUTION,
  "Elephant.glb": polyPizzaJeremyAttribution("9J-cG39KYFC"),
  "Fly.glb": polyPizzaJeremyAttribution("f8kM9xA_5sV"),
  "Frog.glb": polyPizzaJeremyAttribution("07-wJ9bkzul"),
  "Gorilla.glb": polyPizzaJeremyAttribution("1aReOCuu0TY"),
  "Hippo.glb": polyPizzaJeremyAttribution("6fQJsxfOGUP"),
  "Horse.glb": polyPizzaJeremyAttribution("2lIMvzwQBV3"),
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
  "Shark.glb": polyPizzaJeremyAttribution("1SaSTXCFsgo"),
  "Snail.glb": polyPizzaJeremyAttribution("abd7jfOGZ94"),
  "Wolf.glb": polyPizzaJeremyAttribution("2PDe5PSncTC"),
  "Zebra.glb": polyPizzaJeremyAttribution("cKi5RxMBUxO"),
  "Bicycle.glb": polyPizzaJeremyAttribution("axc03j3xKfz"),
  "Dump truck.glb": polyPizzaJeremyAttribution("1BpGYg14QGD"),
  "Policecar.glb": polyPizzaJeremyAttribution("3oBDp9Z3OFH"),
  "Taxi.glb": polyPizzaJeremyAttribution("coQbjlCqWY9"),
  "Truck.glb": polyPizzaJeremyAttribution("cPVFA5uTr9l"),
  "Acousticguitar.glb": polyPizzaJeremyAttribution("afr6GCpce_I"),
  "Electricguitar.glb": polyPizzaJeremyAttribution("0hg94uOO-sS"),
  "Trumpet.glb": polyPizzaJeremyAttribution("0Mj5XgeGtKJ"),
  "Violin.glb": polyPizzaJeremyAttribution("fhj0GK-0kJu"),
  "apple.glb": polyPizzaJeremyAttribution("4tOmpD9-xsV"),
  "BottleChampagne.glb": polyPizzaJeremyAttribution("fCWg2Z6OSku"),
  "Eggplant.glb": polyPizzaJeremyAttribution("e_6auCzeiCC"),
  "Grapes.glb": polyPizzaJeremyAttribution("csU4Smr2_aV"),
  "Hot dog.glb": polyPizzaJeremyAttribution("eiPR4iwcYpa"),
  "Watermelon.glb": polyPizzaJeremyAttribution("5NXaNnNIzfC"),
  "Cactus.glb": polyPizzaJeremyAttribution("fr1vXosiRgr"),
  "Campfire.glb": polyPizzaJeremyAttribution("dxxHpVXHLZg"),
  "Drill.glb": polyPizzaJeremyAttribution("93nEcwogYE0"),
  "Globe.glb": polyPizzaJeremyAttribution("2445qv4neDQ"),
  "tree.glb": PARFAITUWU_TREE_ATTRIBUTION,

  "medieval/Bags.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Barrel.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Bell.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Bonfire.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Cart.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Cauldron.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Crate.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Package.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Package-kYvD6QCQRd.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Path Straight.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Rocks.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Sawmill Saw.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Smoke.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Well.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Window.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,
  "medieval/Window-EY1zrFcme9.glb": QUATERNIUS_MEDIEVAL_VILLAGE_ATTRIBUTION,

  "city/Skyscraper.glb": KENNEY_CITY_KIT_ATTRIBUTION,
  "city/Large Building.glb": KENNEY_CITY_KIT_ATTRIBUTION,
  "city/Small Building.glb": KENNEY_CITY_KIT_ATTRIBUTION,

  "urban/Road Bits.glb": polyPizzaCityPackAttribution("Kay Lousberg", "CC0 1.0"),
  "urban/Manhole Cover.glb": polyPizzaCityPackAttribution("J-Toastie", "Creative Commons Attribution"),
  "urban/Car.glb": polyPizzaCityPackAttribution("Quaternius", "CC0 1.0"),
  "urban/SUV.glb": polyPizzaCityPackAttribution("Quaternius", "CC0 1.0"),
  "urban/Van.glb": polyPizzaCityPackAttribution("Poly by Google", "Creative Commons Attribution"),
  "urban/Pickup Truck.glb": polyPizzaCityPackAttribution("Quaternius", "CC0 1.0"),
  "urban/Bus.glb": polyPizzaCityPackAttribution("Poly by Google", "Creative Commons Attribution"),
  "urban/Sports Car.glb": polyPizzaCityPackAttribution("Quaternius", "CC0 1.0"),
  "urban/Police Car.glb": polyPizzaCityPackAttribution("Quaternius", "CC0 1.0"),
  "urban/Motorcycle.glb": polyPizzaCityPackAttribution("Poly by Google", "Creative Commons Attribution"),
  "urban/Stop sign.glb": polyPizzaCityPackAttribution("Poly by Google", "Creative Commons Attribution"),
  "urban/Billboard.glb": polyPizzaCityPackAttribution("Poly by Google", "Creative Commons Attribution"),
  "urban/Dumpster.glb": polyPizzaCityPackAttribution("Quaternius", "CC0 1.0"),
  "urban/Mailbox.glb": polyPizzaCityPackAttribution("J-Toastie", "Creative Commons Attribution"),
  "urban/Fire hydrant.glb": polyPizzaCityPackAttribution("Poly by Google", "Creative Commons Attribution"),
  "urban/Cone.glb": polyPizzaCityPackAttribution("J-Toastie", "Creative Commons Attribution"),
  "urban/Box.glb": polyPizzaCityPackAttribution("Kay Lousberg", "CC0 1.0"),
  "urban/Power Box.glb": polyPizzaCityPackAttribution("J-Toastie", "Creative Commons Attribution"),
  "urban/Air conditioner.glb": polyPizzaCityPackAttribution("Poly by Google", "Creative Commons Attribution"),
  "urban/ATM.glb": polyPizzaCityPackAttribution("J-Toastie", "Creative Commons Attribution"),
  "urban/Planter & Bushes.glb": polyPizzaCityPackAttribution("J-Toastie", "Creative Commons Attribution"),
  "urban/Man.glb": polyPizzaCityPackAttribution("Quaternius", "CC0 1.0"),
  "urban/Animated Woman.glb": polyPizzaCityPackAttribution("Quaternius", "CC0 1.0"),
};
