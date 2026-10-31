//! Biomes of the natural generator. Shared by terrain generation, wildlife
//! spawning and weather, so everything about a biome lives in one place.

export const BIOME = {
  plains: 0,
  flowerField: 1,
  forest: 2,
  birchForest: 3,
  cherryGrove: 4,
  pineForest: 5,
  snowyForest: 6,
  desert: 7,
  tropical: 8,
  mountains: 9,
};

/**
 * Per biome:
 * - trees: [{ type, density }] chance per tree-grid cell (one candidate per 6x6 blocks)
 * - plants: [{ id, chance }] per grass column; `patchy` uses the flower-patch noise
 * - animals: [{ species, weight }] spawn table
 * - weather: relative chances of each weather type
 */
export const BIOMES = [
  {
    id: BIOME.plains, name: "Plains", surface: "grass",
    trees: [{ type: "oak", density: 0.04 }],
    bushes: 0.06, boulders: 0.08,
    plants: [{ name: "tallGrass", chance: 0.28 }, { name: "dandelion", chance: 0.02 }, { name: "poppy", chance: 0.015 }],
    animals: [{ species: "cow", weight: 3 }, { species: "sheep", weight: 3 }, { species: "horse", weight: 2 }, { species: "pig", weight: 2 }, { species: "chicken", weight: 2 }, { species: "rabbit", weight: 2 }, { species: "bird", weight: 2 }, { species: "butterfly", weight: 2 }, { species: "bee", weight: 1 }],
    weather: { clear: 5, cloudy: 3, rain: 2, thunderstorm: 1, fog: 1 },
  },
  {
    id: BIOME.flowerField, name: "Wildflower Meadow", surface: "grass",
    trees: [{ type: "oak", density: 0.02 }, { type: "birch", density: 0.02 }],
    bushes: 0.05, boulders: 0.03,
    plants: [{ name: "tallGrass", chance: 0.18 }, { patchy: ["poppy", "dandelion", "cornflower", "pinkTulip"], chance: 0.38 }],
    animals: [{ species: "butterfly", weight: 5 }, { species: "bee", weight: 4 }, { species: "rabbit", weight: 3 }, { species: "sheep", weight: 2 }, { species: "horse", weight: 2 }, { species: "bird", weight: 2 }],
    weather: { clear: 6, cloudy: 2, rain: 2, fog: 1 },
  },
  {
    id: BIOME.forest, name: "Oak Forest", surface: "grass",
    trees: [{ type: "oak", density: 0.55 }, { type: "birch", density: 0.1 }],
    bushes: 0.18, boulders: 0.08, fallenTrees: 0.25,
    plants: [{ name: "tallGrass", chance: 0.14 }, { name: "fern", chance: 0.05 }, { name: "brownMushroom", chance: 0.012 }, { name: "redMushroom", chance: 0.008 }, { name: "poppy", chance: 0.01 }],
    animals: [{ species: "deer", weight: 3 }, { species: "fox", weight: 2 }, { species: "wolf", weight: 1 }, { species: "rabbit", weight: 2 }, { species: "pig", weight: 2 }, { species: "bird", weight: 3 }, { species: "bear", weight: 1 }],
    weather: { clear: 4, cloudy: 3, rain: 3, thunderstorm: 1, fog: 2 },
  },
  {
    id: BIOME.birchForest, name: "Birch Forest", surface: "grass",
    trees: [{ type: "birch", density: 0.6 }, { type: "oak", density: 0.05 }],
    bushes: 0.1, boulders: 0.05, fallenTrees: 0.3,
    plants: [{ name: "tallGrass", chance: 0.2 }, { name: "dandelion", chance: 0.03 }, { name: "cornflower", chance: 0.02 }],
    animals: [{ species: "deer", weight: 3 }, { species: "rabbit", weight: 3 }, { species: "fox", weight: 1 }, { species: "bird", weight: 3 }, { species: "butterfly", weight: 1 }],
    weather: { clear: 5, cloudy: 3, rain: 2, fog: 2 },
  },
  {
    id: BIOME.cherryGrove, name: "Cherry Blossom Grove", surface: "grass",
    trees: [{ type: "cherry", density: 0.42 }],
    bushes: 0.04, boulders: 0.04, fallenTrees: 0.1,
    plants: [{ name: "pinkTulip", chance: 0.12 }, { name: "tallGrass", chance: 0.16 }, { name: "dandelion", chance: 0.01 }],
    animals: [{ species: "deer", weight: 2 }, { species: "rabbit", weight: 3 }, { species: "bee", weight: 4 }, { species: "butterfly", weight: 3 }, { species: "bird", weight: 2 }, { species: "sheep", weight: 1 }],
    weather: { clear: 6, cloudy: 2, rain: 2, fog: 1 },
  },
  {
    id: BIOME.pineForest, name: "Pine Forest", surface: "grass",
    trees: [{ type: "pine", density: 0.6 }],
    bushes: 0.06, boulders: 0.14, fallenTrees: 0.3,
    plants: [{ name: "fern", chance: 0.14 }, { name: "tallGrass", chance: 0.06 }, { name: "brownMushroom", chance: 0.015 }, { name: "redMushroom", chance: 0.008 }],
    animals: [{ species: "wolf", weight: 3 }, { species: "bear", weight: 2 }, { species: "deer", weight: 2 }, { species: "fox", weight: 2 }, { species: "rabbit", weight: 2 }, { species: "bird", weight: 2 }],
    weather: { clear: 3, cloudy: 4, rain: 3, fog: 3, snow: 1 },
  },
  {
    id: BIOME.snowyForest, name: "Snowy Forest", surface: "snowyGrass",
    trees: [{ type: "snowyPine", density: 0.45 }],
    bushes: 0, boulders: 0.12, fallenTrees: 0.15,
    plants: [],
    animals: [{ species: "wolf", weight: 3 }, { species: "fox", weight: 2 }, { species: "rabbit", weight: 3 }, { species: "bear", weight: 1 }, { species: "deer", weight: 1 }],
    weather: { clear: 3, cloudy: 3, snow: 5, fog: 2 },
  },
  {
    id: BIOME.desert, name: "Desert", surface: "sand",
    trees: [{ type: "cactus", density: 0.2 }],
    bushes: 0, boulders: 0.04,
    plants: [{ name: "deadBush", chance: 0.03, onSand: true }],
    animals: [{ species: "rabbit", weight: 2 }, { species: "bird", weight: 1 }],
    weather: { clear: 9, cloudy: 1, thunderstorm: 1 },
  },
  {
    id: BIOME.tropical, name: "Tropical Forest", surface: "grass",
    trees: [{ type: "jungle", density: 0.75 }],
    bushes: 0.3, boulders: 0.03,
    plants: [{ name: "fern", chance: 0.28 }, { name: "tallGrass", chance: 0.22 }, { name: "poppy", chance: 0.01 }],
    animals: [{ species: "bird", weight: 4 }, { species: "frog", weight: 3 }, { species: "butterfly", weight: 3 }, { species: "pig", weight: 1 }, { species: "chicken", weight: 1 }],
    weather: { clear: 3, cloudy: 2, rain: 5, thunderstorm: 2, fog: 1 },
  },
  {
    id: BIOME.mountains, name: "Mountains", surface: "stone",
    trees: [{ type: "pine", density: 0.08 }],
    bushes: 0, boulders: 0.25,
    plants: [{ name: "tallGrass", chance: 0.05 }],
    animals: [{ species: "bird", weight: 3 }, { species: "sheep", weight: 2 }, { species: "wolf", weight: 1 }],
    weather: { clear: 4, cloudy: 3, fog: 3, snow: 2, thunderstorm: 1 },
  },
];

/** Animals that live in or next to water, spawned at rivers and lakes in any warm biome */
export const WATER_ANIMALS = [
  { species: "fish", weight: 6 },
  { species: "turtle", weight: 1 },
  { species: "frog", weight: 2 },
];

export function biomeName(id) {
  return BIOMES[id]?.name ?? "Unknown";
}
