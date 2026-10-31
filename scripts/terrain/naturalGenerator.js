import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import { RNG } from "../rgs";
import { BLOCK_LAYER, LAYER, blocks as B } from "../blocks";
import { BIOME, BIOMES } from "./biomes";
import { hash2, hash3, seedInt } from "./hash";

/** Default settings for new natural worlds */
export const NATURAL_DEFAULTS = {
  terrain: { scale: 80, magnitude: 0.5, offset: 0.3 },
  biomeScale: 1,
  chunkSize: { width: 32, height: 64 },
};

// Columns computed around a chunk: trees reach 5 blocks from their origin and
// waterfall pools 2 from their spring, so every structure touching the chunk
// is evaluated from identical data no matter which chunk computes it
const MARGIN = 8;
const TREE_GRID = 6;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const FLAG_CHANNEL = 1; // river / stream bed
const FLAG_BANK = 2; // sloped river bank (no trees, no caves)

/**
 * Seeded, deterministic terrain with biomes, mountains, caves, rivers,
 * waterfalls and vegetation. Every decision is a pure function of world
 * coordinates, so chunks generated in any order (or in workers) line up.
 */
export function createNaturalGenerator(params, size) {
  const { width, height: H } = size;
  const seed = seedInt(params.seed);
  const terrain = params.terrain;
  const S = terrain.scale;
  const mag = terrain.magnitude * 2;
  const shift = (terrain.offset - 0.3) * H;
  const biomeScale = params.biomeScale ?? 1;
  const sea = Math.round(H * 0.32);

  const rng = new RNG(params.seed);
  const noise = {};
  for (const name of ["continent", "hills", "detail", "mountain", "ridge", "warpX", "warpZ", "river", "temperature", "moisture", "forest", "birch", "flowers", "cave1", "cave2", "ore"]) {
    noise[name] = new SimplexNoise(rng);
  }
  const fbm = (n, x, z, octaves) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += n.noise(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  //! Columns

  /** Terrain shape at (x, z) before rivers: [height, smooth height] */
  function baseHeight(x, z) {
    const continent = fbm(noise.continent, x / (S * 4), z / (S * 4), 2);
    const hills = fbm(noise.hills, x / S, z / S, 3);
    const detail = noise.detail.noise(x / (S / 4), z / (S / 4));
    const mountainMask = smoothstep(0.1, 0.55, noise.mountain.noise(x / (S * 3), z / (S * 3)));
    let ridge = 1 - Math.abs(noise.ridge.noise(x / (S * 1.1), z / (S * 1.1)));
    ridge *= ridge;
    const smooth = sea + 3 + shift + continent * 7 * mag + hills * 5 * mag + mountainMask * ridge * (H - sea - 10) * mag;
    return [smooth + detail * 1.2, smooth];
  }

  /** River proximity in noise units (0 = river centre) and channel half-width */
  function riverDistance(x, z) {
    const wx = x + 25 * noise.warpX.noise(x / 90, z / 90);
    const wz = z + 25 * noise.warpZ.noise(x / 90, z / 90);
    return Math.abs(noise.river.noise(wx / (S * 3.2), wz / (S * 3.2)));
  }

  function chooseBiome(x, z, height) {
    if (height > sea + 24) return BIOME.mountains;
    const scale = S * 5 * biomeScale;
    const temperature = noise.temperature.noise(x / scale, z / scale) - Math.max(0, height - sea - 12) / 30;
    const moisture = noise.moisture.noise(x / scale + 40, z / scale - 40);
    if (temperature < -0.42) return BIOME.snowyForest;
    if (temperature < -0.15) return BIOME.pineForest;
    if (temperature > 0.42) {
      if (moisture < 0) return BIOME.desert;
      if (moisture > 0.12) return BIOME.tropical;
      return BIOME.plains;
    }
    if (moisture > 0.22) return BIOME.cherryGrove;
    if (moisture > -0.05) return noise.birch.noise(x / (S * 2), z / (S * 2)) > 0.25 ? BIOME.birchForest : BIOME.forest;
    if (moisture < -0.35) return BIOME.flowerField;
    return BIOME.plains;
  }

  /**
   * Fills one column's description: surface height, water level (-1: none),
   * biome and river flags. Waterfall curtains (which need the neighbours)
   * are added afterwards by computeRegion.
   */
  function computeColumn(x, z, out, i) {
    const [h0, smooth] = baseHeight(x, z);
    let height = Math.min(H - 3, Math.max(1, Math.floor(h0)));
    let water = -1;
    let flags = 0;

    // Rivers: the level follows the smoothed terrain, so streams step down
    // mountains and widen into sea-level rivers in the lowlands
    const distance = riverDistance(x, z);
    const halfWidth = 0.025 + 0.045 * (1 - smoothstep(sea + 4, sea + 16, smooth));
    if (distance < halfWidth * 2.6) {
      const level = Math.max(sea, Math.floor(smooth) - 2);
      if (distance < halfWidth) {
        const depth = level === sea ? 1 + Math.round((1 - distance / halfWidth) * 3) : 1;
        height = Math.min(height, level - depth);
        water = level;
        flags |= FLAG_CHANNEL;
      } else {
        const t = smoothstep(0, 1, (distance - halfWidth) / (halfWidth * 1.6));
        height = Math.min(height, Math.round(level + 1 + (height - level - 1) * t));
        flags |= FLAG_BANK;
      }
    }
    // Lakes and seas fill everything below sea level
    if (height < sea && water < sea) water = sea;

    out.height[i] = height;
    out.water[i] = water;
    out.flags[i] = flags;
    out.biome[i] = chooseBiome(x, z, height);
    out.curtain[i] = -1;
  }

  function createColumns(count) {
    return {
      height: new Int16Array(count),
      water: new Int16Array(count),
      curtain: new Int16Array(count), // waterfall: water rises to this level
      flags: new Uint8Array(count),
      biome: new Uint8Array(count),
    };
  }

  /** Column data for the chunk plus a margin, with waterfalls resolved */
  function computeRegion(originX, originZ) {
    const side = width + MARGIN * 2;
    const cols = createColumns(side * side);
    const startX = originX - MARGIN;
    const startZ = originZ - MARGIN;
    for (let x = 0; x < side; x++) {
      for (let z = 0; z < side; z++) computeColumn(startX + x, startZ + z, cols, x * side + z);
    }
    const at = (wx, wz) => {
      const x = wx - startX;
      const z = wz - startZ;
      return x >= 0 && z >= 0 && x < side && z < side ? x * side + z : -1;
    };
    return { cols, at, startX, startZ, side };
  }

  //! Chunk generation

  function generateChunk(chunkX, chunkZ) {
    const originX = chunkX * width;
    const originZ = chunkZ * width;
    const blocks = new Uint8Array(width * H * width);
    const index = (x, y, z) => (x * H + y) * width + z;
    const region = computeRegion(originX, originZ);
    const { cols, at } = region;
    const waterfalls = [];

    /** Writes a block at world coordinates if it falls inside this chunk */
    const set = (wx, wy, wz, id, { force = false } = {}) => {
      const x = wx - originX;
      const z = wz - originZ;
      if (x < 0 || z < 0 || x >= width || z >= width || wy < 1 || wy >= H) return;
      const i = index(x, wy, z);
      const current = blocks[i];
      // Structures only grow into air or plants (unless forced, e.g. trunks, boulders)
      if (!force && current !== 0 && BLOCK_LAYER[current] !== LAYER.plant) return;
      blocks[i] = id;
    };

    resolveWaterfalls(region, waterfalls, originX, originZ);

    // Terrain layers, water, caves and ores
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < width; z++) {
        const wx = originX + x;
        const wz = originZ + z;
        const c = at(wx, wz);
        const height = cols.height[c];
        const water = Math.max(cols.water[c], cols.curtain[c]);
        const biome = cols.biome[c];
        const [top, filler, fillerDepth] = surfaceLayers(biome, height, water, cols.flags[c]);
        const canCave = water < 0 && !(cols.flags[c] & FLAG_BANK) && height > sea + 3;

        for (let y = 0; y <= height; y++) {
          let id = y === height ? top : y >= height - fillerDepth ? filler : B.stone.id;
          if (y > 1 && canCave && isCave(wx, y, wz)) continue;
          if (id === B.stone.id && y < height - 4) id = ore(wx, y, wz) ?? id;
          blocks[index(x, y, z)] = id;
        }
        for (let y = height + 1; y <= water; y++) blocks[index(x, y, z)] = B.water.id;
      }
    }

    placeStructures(region, set, originX, originZ);
    placePlants(region, blocks, index, originX, originZ);

    const centre = at(originX + (width >> 1), originZ + (width >> 1));
    return { blocks, features: { waterfalls, biome: cols.biome[centre] } };
  }

  /** [top block, filler block, filler depth] for a column */
  function surfaceLayers(biome, height, water, flags) {
    if (water >= height + 1) {
      // Underwater: sandy lake beds, gravelly stream beds
      return flags & FLAG_CHANNEL && water > sea ? [B.gravel.id, B.dirt.id, 2] : [B.sand.id, B.sand.id, 2];
    }
    if (height <= sea + 1 && biome !== BIOME.snowyForest) return [B.sand.id, B.sand.id, 3];
    switch (biome) {
      case BIOME.desert:
        return [B.sand.id, B.sand.id, 4];
      case BIOME.snowyForest:
        return [B.snowyGrass.id, B.dirt.id, 3];
      case BIOME.mountains:
        if (height > sea + 34) return [B.snow.id, B.stone.id, 1];
        if (height > sea + 28) return [B.stone.id, B.stone.id, 0];
        return [B.grass.id, B.dirt.id, 2];
      default:
        return [B.grass.id, B.dirt.id, 3];
    }
  }

  // Spaghetti caves: tunnels where two 3D noise fields are both near zero
  function isCave(x, y, z) {
    const a = noise.cave1.noise3d(x / 28, y / 18, z / 28);
    if (Math.abs(a) > 0.12) return false;
    const b = noise.cave2.noise3d(x / 28, y / 18, z / 28);
    return a * a + b * b < 0.012;
  }

  function ore(x, y, z) {
    const r = hash3(seed, x, y, z, 7);
    if (r > 0.09) return null;
    const vein = noise.ore.noise3d(x / 9, y / 9, z / 9);
    if (vein > 0.55) return y < sea - 2 && r < 0.03 ? B.ironOre.id : B.coalOre.id;
    return null;
  }

  //! Waterfalls

  /**
   * Two kinds, both decided per column from pure functions:
   * - stream steps: where a stream's level drops 2+ blocks, the lower column
   *   holds a curtain of water up to the upper level (and a deeper pool)
   * - cliff springs: rare springs at the top of steep drops spill down the
   *   cliff face into a pool below
   */
  function resolveWaterfalls(region, waterfalls, originX, originZ) {
    const { cols, at, startX, startZ, side } = region;
    const inChunk = (wx, wz) => wx >= originX && wz >= originZ && wx < originX + width && wz < originZ + width;
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // Decisions read the untouched columns so the result doesn't depend on scan order
    const height0 = cols.height.slice();
    const water0 = cols.water.slice();

    for (let x = 1; x < side - 1; x++) {
      for (let z = 1; z < side - 1; z++) {
        const wx = startX + x;
        const wz = startZ + z;
        const c = x * side + z;

        if (cols.flags[c] & FLAG_CHANNEL) {
          let upper = -1;
          for (const [dx, dz] of neighbours) {
            const n = at(wx + dx, wz + dz);
            if (cols.flags[n] & FLAG_CHANNEL && water0[n] - water0[c] >= 2) upper = Math.max(upper, water0[n]);
          }
          if (upper > 0) {
            cols.curtain[c] = Math.max(cols.curtain[c], upper - 1);
            cols.height[c] = Math.min(cols.height[c], water0[c] - 2);
            if (inChunk(wx, wz)) waterfalls.push({ x: wx, y: water0[c], z: wz, height: upper - water0[c] });
          }
          continue;
        }

        const height = height0[c];
        if (water0[c] >= 0 || cols.flags[c] || height < sea + 6) continue;
        if (cols.biome[c] === BIOME.desert || hash2(seed, wx, wz, 11) > 0.035) continue;
        let low = null;
        for (const [dx, dz] of neighbours) {
          const n = at(wx + dx, wz + dz);
          if (water0[n] < 0 && height - height0[n] >= 4 && (!low || height0[n] < height0[low.n])) {
            low = { n, wx: wx + dx, wz: wz + dz };
          }
        }
        if (!low) continue;
        const bottom = height0[low.n];
        // Spring at the cliff top, curtain down the face, pool at the foot
        cols.water[c] = Math.max(cols.water[c], height);
        cols.height[c] = Math.min(cols.height[c], height - 1);
        cols.curtain[low.n] = Math.max(cols.curtain[low.n], height - 1);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const p = at(low.wx + dx, low.wz + dz);
            if (p < 0 || water0[p] >= 0 || Math.abs(height0[p] - bottom) > 1) continue;
            cols.height[p] = Math.min(cols.height[p], bottom - (dx === 0 && dz === 0 ? 2 : 1));
            cols.water[p] = Math.max(cols.water[p], bottom);
          }
        }
        if (inChunk(low.wx, low.wz)) waterfalls.push({ x: low.wx, y: bottom, z: low.wz, height: height - bottom });
      }
    }
  }

  //! Trees, bushes, boulders, fallen logs

  function placeStructures(region, set, originX, originZ) {
    const { cols, at } = region;
    // Furthest any structure extends from its origin (cherry crowns, fallen logs)
    const reach = 5;
    const minX = originX - reach;
    const minZ = originZ - reach;
    const maxX = originX + width + reach;
    const maxZ = originZ + width + reach;

    const groundAt = (wx, wz) => {
      const c = at(wx, wz);
      if (c < 0 || cols.water[c] >= 0 || cols.curtain[c] >= 0 || cols.flags[c]) return null;
      return { c, height: cols.height[c], biome: cols.biome[c] };
    };

    forEachGridPoint(TREE_GRID, 1, minX, minZ, maxX, maxZ, (wx, wz, r) => {
      const ground = groundAt(wx, wz);
      if (!ground || ground.height > H - 15 || ground.height <= sea) return;
      const biome = BIOMES[ground.biome];
      const forest = 0.35 + 0.65 * smoothstep(-0.4, 0.4, noise.forest.noise(wx / 40, wz / 40));
      let cumulative = 0;
      for (const tree of biome.trees) {
        cumulative += tree.density * (tree.type === "cactus" ? 1 : forest);
        if (r < cumulative) {
          buildTree(tree.type, wx, ground.height + 1, wz, set);
          return;
        }
      }
    });

    forEachGridPoint(5, 2, minX, minZ, maxX, maxZ, (wx, wz, r) => {
      const ground = groundAt(wx, wz);
      if (!ground || r >= BIOMES[ground.biome].bushes) return;
      const leaves = ground.biome === BIOME.tropical ? B.jungleLeaves.id : B.leaves.id;
      set(wx, ground.height + 1, wz, leaves);
      if (hash2(seed, wx, wz, 21) < 0.5) set(wx + 1, ground.height + 1, wz, leaves);
      if (hash2(seed, wx, wz, 22) < 0.3) set(wx, ground.height + 2, wz, leaves);
    });

    forEachGridPoint(14, 3, minX, minZ, maxX, maxZ, (wx, wz, r) => {
      const ground = groundAt(wx, wz);
      if (!ground || r >= BIOMES[ground.biome].boulders * 0.6) return;
      const radius = hash2(seed, wx, wz, 31) < 0.6 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -1; dy <= radius; dy++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx * dx + dy * dy * 1.4 + dz * dz > radius * radius + 0.6) continue;
            const pick = hash3(seed, wx + dx, ground.height + dy, wz + dz, 32);
            const id = pick < 0.45 ? B.stone.id : pick < 0.75 ? B.cobblestone.id : B.mossyCobblestone.id;
            set(wx + dx, ground.height + dy, wz + dz, id, { force: dy <= 0 });
          }
        }
      }
    });

    forEachGridPoint(16, 4, minX, minZ, maxX, maxZ, (wx, wz, r) => {
      const ground = groundAt(wx, wz);
      if (!ground || r >= (BIOMES[ground.biome].fallenTrees ?? 0) * 0.5) return;
      const length = 3 + Math.floor(hash2(seed, wx, wz, 41) * 3);
      const alongX = hash2(seed, wx, wz, 42) < 0.5;
      for (let i = 0; i < length; i++) {
        const g = groundAt(wx + (alongX ? i : 0), wz + (alongX ? 0 : i));
        if (!g || g.height !== ground.height) return;
      }
      const log = logForBiome(ground.biome);
      for (let i = 0; i < length; i++) set(wx + (alongX ? i : 0), ground.height + 1, wz + (alongX ? 0 : i), log);
      if (hash2(seed, wx, wz, 43) < 0.5) set(wx + (alongX ? 1 : 0), ground.height + 2, wz + (alongX ? 0 : 1), B.brownMushroom.id);
    });
  }

  /** One candidate point per grid cell, jittered, with a random value r for the caller */
  function forEachGridPoint(grid, salt, minX, minZ, maxX, maxZ, visit) {
    for (let gx = Math.floor(minX / grid) - 1; gx <= Math.floor(maxX / grid); gx++) {
      for (let gz = Math.floor(minZ / grid) - 1; gz <= Math.floor(maxZ / grid); gz++) {
        const wx = gx * grid + Math.floor(hash2(seed, gx, gz, salt * 10 + 1) * grid);
        const wz = gz * grid + Math.floor(hash2(seed, gx, gz, salt * 10 + 2) * grid);
        if (wx < minX || wz < minZ || wx >= maxX || wz >= maxZ) continue;
        visit(wx, wz, hash2(seed, gx, gz, salt * 10 + 3));
      }
    }
  }

  function logForBiome(biome) {
    if (biome === BIOME.birchForest) return B.birchLog.id;
    if (biome === BIOME.cherryGrove) return B.cherryLog.id;
    if (biome === BIOME.pineForest || biome === BIOME.snowyForest || biome === BIOME.mountains) return B.pineLog.id;
    return B.wood.id;
  }

  /** Builds a tree with its base at (x, y, z); size and shape vary per position */
  function buildTree(type, x, y, z, set) {
    const r = (salt) => hash2(seed, x, z, 100 + salt);
    const trunk = (id, height, dx = 0, dz = 0) => {
      for (let i = 0; i < height; i++) set(x + dx, y + i, z + dz, id, { force: true });
    };
    const blob = (cx, cy, cz, radius, leaf, squash = 1, holes = 0.12) => {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dz = -radius; dz <= radius; dz++) {
            const d = dx * dx + (dy * dy) / (squash * squash) + dz * dz;
            if (d > radius * radius + 0.5) continue;
            // Ragged edges so no two canopies look the same
            if (d > (radius - 1) * (radius - 1) && hash3(seed, cx + dx, cy + dy, cz + dz, 5) < holes) continue;
            set(cx + dx, cy + dy, cz + dz, leaf);
          }
        }
      }
    };

    switch (type) {
      case "oak": {
        const height = 4 + Math.floor(r(1) * 3);
        trunk(B.wood.id, height);
        blob(x, y + height - 1, z, 2 + (r(2) < 0.3 ? 1 : 0), B.leaves.id, 0.8);
        break;
      }
      case "birch": {
        const height = 5 + Math.floor(r(1) * 3);
        trunk(B.birchLog.id, height);
        blob(x, y + height - 1, z, 2, B.birchLeaves.id, 1.3, 0.3);
        set(x, y + height + 1, z, B.birchLeaves.id);
        break;
      }
      case "cherry": {
        // Leaning trunk with a wide, flat crown and a smaller side crown
        const height = 4 + Math.floor(r(1) * 3);
        const lean = r(2) < 0.5 ? 1 : -1;
        const alongX = r(3) < 0.5;
        const ox = alongX ? lean : 0;
        const oz = alongX ? 0 : lean;
        trunk(B.cherryLog.id, height - 1);
        set(x + ox, y + height - 1, z + oz, B.cherryLog.id, { force: true });
        set(x + ox, y + height, z + oz, B.cherryLog.id, { force: true });
        blob(x + ox, y + height + 1, z + oz, 3, B.cherryLeaves.id, 0.55, 0.25);
        if (r(4) < 0.6) {
          set(x - ox, y + height - 2, z - oz, B.cherryLog.id, { force: true });
          blob(x - ox * 2, y + height - 1, z - oz * 2, 2, B.cherryLeaves.id, 0.6, 0.3);
        }
        break;
      }
      case "pine":
      case "snowyPine": {
        const height = 6 + Math.floor(r(1) * 5);
        trunk(B.pineLog.id, height);
        // Tiered cone: radius grows downwards, shrinking every other layer
        for (let i = 0; i <= height - 2; i++) {
          const layer = y + height - i;
          const radius = Math.min(3, Math.floor(i * 0.5 + 0.5)) - (i % 2 === 1 && i > 2 ? 1 : 0);
          for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
              if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
              set(x + dx, layer, z + dz, B.pineLeaves.id);
            }
          }
        }
        set(x, y + height + 1, z, type === "snowyPine" ? B.snow.id : B.pineLeaves.id);
        break;
      }
      case "jungle": {
        const height = 8 + Math.floor(r(1) * 5);
        trunk(B.jungleLog.id, height);
        blob(x, y + height, z, 3, B.jungleLeaves.id, 0.7, 0.2);
        blob(x, y + height - 4, z, 2, B.jungleLeaves.id, 0.6, 0.35);
        break;
      }
      case "cactus": {
        const height = 1 + Math.floor(r(1) * 3);
        for (let i = 0; i < height; i++) set(x, y + i, z, B.cactus.id);
        break;
      }
    }
  }

  //! Ground plants

  function placePlants(region, blocks, index, originX, originZ) {
    const { cols, at } = region;
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < width; z++) {
        const wx = originX + x;
        const wz = originZ + z;
        const c = at(wx, wz);
        const height = cols.height[c];
        if (height + 1 >= H || cols.water[c] >= 0 || cols.curtain[c] >= 0) continue;
        const top = blocks[index(x, height, z)];
        if (blocks[index(x, height + 1, z)] !== 0) continue;
        const onSand = top === B.sand.id;
        if (top !== B.grass.id && !onSand) continue;

        let roll = hash2(seed, wx, wz, 60);
        for (const plant of BIOMES[cols.biome[c]].plants) {
          if (!!plant.onSand !== onSand) continue;
          if (roll < plant.chance) {
            let name = plant.name;
            if (plant.patchy) {
              const patch = noise.flowers.noise(wx / 14, wz / 14) * 0.5 + 0.5;
              name = plant.patchy[Math.min(plant.patchy.length - 1, Math.floor(patch * plant.patchy.length))];
            }
            blocks[index(x, height + 1, z)] = B[name].id;
            break;
          }
          roll -= plant.chance;
        }
      }
    }
  }

  //! Queries (main thread: spawning, biome display, weather)

  const sampleCols = createColumns(1);

  return {
    type: "natural",
    seaLevel: sea,

    generateChunk,

    /** Surface height, biome and water level at a world column (ignores structures) */
    sampleColumn(x, z) {
      computeColumn(Math.floor(x), Math.floor(z), sampleCols, 0);
      return { height: sampleCols.height[0], biome: sampleCols.biome[0], waterLevel: sampleCols.water[0] };
    },

    /** A dry, scenic spot near the origin (cherry groves and forests preferred) */
    findSpawn() {
      const preferred = [BIOME.cherryGrove, BIOME.forest, BIOME.flowerField, BIOME.birchForest, BIOME.plains];
      let fallback = null;
      for (let radius = 0; radius <= 1200; radius += 16) {
        const steps = Math.max(1, Math.round((radius * Math.PI * 2) / 16));
        for (let s = 0; s < steps; s++) {
          const angle = (s / steps) * Math.PI * 2;
          const x = Math.round(Math.cos(angle) * radius);
          const z = Math.round(Math.sin(angle) * radius);
          computeColumn(x, z, sampleCols, 0);
          const dry = sampleCols.water[0] < 0 && !sampleCols.flags[0] && sampleCols.height[0] > sea + 1 && sampleCols.height[0] < H - 16;
          if (!dry) continue;
          if (preferred.includes(sampleCols.biome[0])) return { x, z };
          fallback ??= { x, z };
        }
        if (fallback && radius > 600) return fallback;
      }
      return fallback ?? { x: 0, z: 0 };
    },
  };
}
