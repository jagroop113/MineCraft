import { describe, expect, it, vi } from "vitest";
import { BLOCK_LAYER, LAYER, blocks } from "../scripts/blocks";
import { BIOME } from "../scripts/terrain/biomes";
import { createGenerator } from "../scripts/terrain/generators";
import { World } from "../scripts/world";
import { findRenderingMismatches } from "./helpers";

// These tests generate real terrain on the main thread; allow slower machines time
vi.setConfig({ testTimeout: 30000 });

const SIZE = { width: 16, height: 64 };
const params = (seed) => ({ seed, generator: "natural", biomeScale: 1, terrain: { scale: 80, magnitude: 0.5, offset: 0.3 } });
const index = (x, y, z) => (x * SIZE.height + y) * SIZE.width + z;

/** Generates a rectangle of chunks and returns a world-coordinate block lookup */
function sampleArea(generator, fromX, fromZ, chunksX, chunksZ) {
  const chunks = new Map();
  for (let cx = fromX; cx < fromX + chunksX; cx++)
    for (let cz = fromZ; cz < fromZ + chunksZ; cz++) chunks.set(`${cx},${cz}`, generator.generateChunk(cx, cz));
  const get = (x, y, z) => {
    const cx = Math.floor(x / SIZE.width);
    const cz = Math.floor(z / SIZE.width);
    return chunks.get(`${cx},${cz}`)?.blocks[index(x - cx * SIZE.width, y, z - cz * SIZE.width)];
  };
  return { chunks, get };
}

describe("natural terrain generation", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    const a = createGenerator(params(1234), SIZE).generateChunk(3, -2);
    const b = createGenerator(params(1234), SIZE).generateChunk(3, -2);
    const c = createGenerator(params(99), SIZE).generateChunk(3, -2);
    expect(Array.from(a.blocks)).toEqual(Array.from(b.blocks));
    expect(a.features).toEqual(b.features);
    expect(Array.from(a.blocks)).not.toEqual(Array.from(c.blocks));
  });

  it("generates far away chunks (the world is endless)", () => {
    const { blocks: data } = createGenerator(params(5), SIZE).generateChunk(40000, -40000);
    expect(data.some((id) => id !== 0)).toBe(true);
  });

  it("produces the same blocks whichever chunk order generates them (seamless borders)", () => {
    const generator = createGenerator(params(77), SIZE);
    // Trees, boulders and waterfalls crossing a border must be written identically on both sides:
    // compare a chunk generated alone with the same chunk generated after its neighbours
    const alone = createGenerator(params(77), SIZE).generateChunk(1, 1);
    for (const [x, z] of [[0, 1], [2, 1], [1, 0], [1, 2]]) generator.generateChunk(x, z);
    expect(Array.from(generator.generateChunk(1, 1).blocks)).toEqual(Array.from(alone.blocks));
  });

  it("continues terrain smoothly across chunk borders", () => {
    const generator = createGenerator(params(31), SIZE);
    const { get } = sampleArea(generator, -2, -2, 4, 4);
    const surface = (x, z) => {
      for (let y = SIZE.height - 1; y >= 0; y--) {
        const id = get(x, y, z);
        if (id && BLOCK_LAYER[id] === LAYER.opaque && ![blocks.leaves.id, blocks.wood.id, blocks.birchLog.id, blocks.cherryLog.id, blocks.pineLog.id, blocks.jungleLog.id, blocks.birchLeaves.id, blocks.cherryLeaves.id, blocks.pineLeaves.id, blocks.jungleLeaves.id, blocks.snow.id, blocks.cactus.id, blocks.stone.id, blocks.cobblestone.id, blocks.mossyCobblestone.id].includes(id)) return y;
      }
      return 0;
    };
    // Height steps across chunk borders look like steps anywhere else (no cliffs at seams)
    let borderSteps = 0;
    let insideSteps = 0;
    for (let z = -32; z < 32; z++) {
      borderSteps = Math.max(borderSteps, Math.abs(surface(-1, z) - surface(0, z)), Math.abs(surface(15, z) - surface(16, z)));
      insideSteps = Math.max(insideSteps, Math.abs(surface(5, z) - surface(6, z)));
    }
    expect(borderSteps).toBeLessThanOrEqual(Math.max(4, insideSteps + 2));
  });

  it("has biomes, including cherry blossom groves with cherry trees and pink flowers", () => {
    const generator = createGenerator(params(2024), SIZE);
    const biomes = new Set();
    let cherry = null;
    for (let x = -3000; x <= 3000 && !cherry; x += 40) {
      for (let z = -3000; z <= 3000; z += 40) {
        const { biome, waterLevel } = generator.sampleColumn(x, z);
        biomes.add(biome);
        if (biome === BIOME.cherryGrove && waterLevel < 0 && !cherry) cherry = { x, z };
      }
    }
    expect(biomes.size).toBeGreaterThanOrEqual(6);
    expect(cherry).not.toBeNull();

    // Generate the area around the grove and count its blossoms
    const cx = Math.floor(cherry.x / SIZE.width);
    const cz = Math.floor(cherry.z / SIZE.width);
    const { chunks } = sampleArea(generator, cx - 2, cz - 2, 5, 5);
    const counts = { cherryLog: 0, cherryLeaves: 0, pinkTulip: 0 };
    for (const { blocks: data } of chunks.values())
      for (const id of data) {
        if (id === blocks.cherryLog.id) counts.cherryLog++;
        if (id === blocks.cherryLeaves.id) counts.cherryLeaves++;
        if (id === blocks.pinkTulip.id) counts.pinkTulip++;
      }
    expect(counts.cherryLog).toBeGreaterThan(10);
    expect(counts.cherryLeaves).toBeGreaterThan(200);
    expect(counts.pinkTulip).toBeGreaterThan(5);
  });

  it("varies tree size and shape", () => {
    const generator = createGenerator(params(8), SIZE);
    const { get } = sampleArea(generator, 0, 0, 6, 6);
    const trunkHeights = new Set();
    for (let x = 0; x < 96; x++)
      for (let z = 0; z < 96; z++)
        for (let y = 1; y < SIZE.height; y++) {
          const id = get(x, y, z);
          if (![blocks.wood.id, blocks.birchLog.id, blocks.pineLog.id, blocks.cherryLog.id, blocks.jungleLog.id].includes(id)) continue;
          if (get(x, y - 1, z) === id) continue; // count from the bottom of each trunk
          let height = 0;
          while (get(x, y + height, z) === id) height++;
          if (height > 2) trunkHeights.add(height);
        }
    expect(trunkHeights.size).toBeGreaterThanOrEqual(3);
  });

  it("carves caves underground", () => {
    const generator = createGenerator(params(3), SIZE);
    let caveCells = 0;
    for (let cx = 0; cx < 6; cx++) {
      const { blocks: data } = generator.generateChunk(cx, 0);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) {
          let solidAbove = false;
          for (let y = SIZE.height - 1; y > 1; y--) {
            const id = data[index(x, y, z)];
            if (id === blocks.stone.id || id === blocks.dirt.id) solidAbove = true;
            else if (id === 0 && solidAbove) caveCells++;
          }
        }
    }
    expect(caveCells).toBeGreaterThan(20);
  });
});

describe("rivers and waterfalls", () => {
  it("rivers are continuous water channels that cross chunk borders", () => {
    const generator = createGenerator(params(4242), SIZE);
    // Find a river crossing a chunk border: water above sea-level-ish beds on both sides of x = 0 | -1
    let found = null;
    for (let z = -4000; z < 4000 && !found; z += 3) {
      const a = generator.sampleColumn(-1, z);
      const b = generator.sampleColumn(0, z);
      if (a.waterLevel > 0 && b.waterLevel > 0 && generator.sampleColumn(0, z).height < a.waterLevel) found = z;
    }
    expect(found).not.toBeNull();
    const cz = Math.floor(found / SIZE.width);
    const { get } = sampleArea(generator, -1, cz - 1, 2, 3);
    const { waterLevel } = generator.sampleColumn(0, found);
    expect(get(-1, waterLevel, found)).toBe(blocks.water.id);
    expect(get(0, waterLevel, found)).toBe(blocks.water.id);
  });

  it("places waterfalls as continuous water columns ending in a pool", () => {
    const generator = createGenerator(params(7), SIZE);
    let fall = null;
    let chunkCoords = null;
    for (let cx = -30; cx < 30 && !fall; cx++)
      for (let cz = -30; cz < 30 && !fall; cz++) {
        const { features } = generator.generateChunk(cx, cz);
        if (features.waterfalls.length) {
          fall = features.waterfalls[0];
          chunkCoords = { cx, cz };
        }
      }
    expect(fall).not.toBeNull();
    const { get } = sampleArea(generator, chunkCoords.cx - 1, chunkCoords.cz - 1, 3, 3);
    // Water all the way down the falling column, and a pool (water) at its base
    for (let y = fall.y; y < fall.y + fall.height - 1; y++) expect(get(fall.x, y, fall.z)).toBe(blocks.water.id);
    expect(fall.height).toBeGreaterThanOrEqual(2);
    expect([blocks.water.id, blocks.gravel.id, blocks.sand.id, blocks.dirt.id, blocks.stone.id]).toContain(get(fall.x, fall.y - 1, fall.z));
  });
});

describe("streaming world", () => {
  function naturalWorld(seed = 11) {
    const world = new World();
    world.params = params(seed);
    world.chunkSize = { ...SIZE };
    world.drawDistance = 2;
    return world;
  }
  const playerAt = (x, z) => ({ position: { x, y: 40, z } });

  it("loads chunks as the player explores and unloads distant ones", () => {
    const world = naturalWorld();
    world.meshBudgetMs = Infinity;
    for (let step = 0; step < 40; step++) world.update(playerAt(8, 8));
    const nearCount = world.loadedChunkCount;
    expect(nearCount).toBe(21); // circle of radius 2.5 chunks
    expect(world.isLoadedAt(8 + 16 * 2, 8)).toBe(true);

    // Walk 20 chunks east
    for (let x = 8; x < 8 + 16 * 20; x += 8) for (let i = 0; i < 4; i++) world.update(playerAt(x, 8));
    for (let step = 0; step < 40; step++) world.update(playerAt(8 + 16 * 20, 8));
    expect(world.isLoadedAt(8 + 16 * 20, 8)).toBe(true);
    expect(world.isLoadedAt(8, 8)).toBe(false);
    // Memory stays bounded: only chunks near the player remain
    expect(world.loadedChunkCount).toBeLessThanOrEqual(37);
    expect(world.children.length).toBe(world.loadedChunkCount);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("keeps player edits when a chunk is unloaded and loaded again", async () => {
    const world = naturalWorld();
    await world.loadAround(8, 8, 1);
    const y = world.getSurfaceHeight(8, 8);
    world.setBlock(8, y, 8, blocks.brick.id);
    world.setBlock(8, y - 1, 8, blocks.empty.id);

    world.meshBudgetMs = Infinity;
    for (let i = 0; i < 20; i++) world.update(playerAt(8 + 16 * 12, 8));
    expect(world.isLoadedAt(8, 8)).toBe(false);

    await world.loadAround(8, 8, 1);
    expect(world.getBlockId(8, y, 8)).toBe(blocks.brick.id);
    expect(world.getBlockId(8, y - 1, 8)).toBe(blocks.empty.id);
  });

  it("builds inside generated environments (plants are replaced, trees stay solid)", () => {
    const world = naturalWorld(2024);
    world.generate();
    const plant = [...world.children].flatMap((chunk) => {
      const out = [];
      for (let i = 0; i < chunk.blocks.length && out.length < 1; i++) {
        if (BLOCK_LAYER[chunk.blocks[i]] === LAYER.plant) {
          const x = Math.floor(i / (64 * 16));
          const y = Math.floor(i / 16) % 64;
          const z = i % 16;
          out.push([chunk.position.x + x, y, chunk.position.z + z]);
        }
      }
      return out;
    })[0];
    expect(plant).toBeDefined();
    expect(world.setBlock(...plant, blocks.oakPlanks.id)).toBe(true);
    expect(world.getBlockId(...plant)).toBe(blocks.oakPlanks.id);
    expect(findRenderingMismatches(world)).toEqual([]);
  });
});
