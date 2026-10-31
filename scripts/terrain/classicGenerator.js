import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import { RNG } from "../rgs";

const EMPTY = 0;
const GRASS = 1;
const DIRT = 2;
const STONE = 3;

/**
 * The original terrain algorithm (grass/dirt/stone heightmap plus ore noise),
 * unchanged so worlds saved before the natural generator load identically.
 * It works for any chunk coordinates, so classic worlds are infinite too.
 *
 * @param {{ seed: number, terrain: { scale: number, magnitude: number, offset: number } }} params
 * @param {{ width: number, height: number }} size
 * @param {{ id: number, scale: {x,y,z}, scarcity: number }[]} resources
 */
export function createClassicGenerator(params, size, resources) {
  // Same RNG consumption order as before: terrain noise first, then resource noise
  const rng = new RNG(params.seed);
  const terrainNoise = new SimplexNoise(rng);
  const resourceNoise = new SimplexNoise(rng);
  const { width, height: maxHeight } = size;

  function columnHeight(x, z) {
    const value = terrainNoise.noise(x / params.terrain.scale, z / params.terrain.scale);
    const scaledNoise = params.terrain.offset + params.terrain.magnitude * value;
    return Math.max(0, Math.min(Math.floor(maxHeight * scaledNoise), maxHeight - 1));
  }

  return {
    type: "classic",

    /** @returns {{ blocks: Uint8Array, features: object }} */
    generateChunk(chunkX, chunkZ) {
      const blocks = new Uint8Array(width * maxHeight * width);
      const originX = chunkX * width;
      const originZ = chunkZ * width;
      const index = (x, y, z) => (x * maxHeight + y) * width + z;

      for (let x = 0; x < width; x++) {
        for (let z = 0; z < width; z++) {
          const height = columnHeight(originX + x, originZ + z);
          for (let y = 0; y <= height; y++) {
            blocks[index(x, y, z)] = y === height ? GRASS : y > height - 3 ? DIRT : STONE;
          }
        }
      }

      for (const resource of resources) {
        for (let x = 0; x < width; x++) {
          for (let y = 0; y < maxHeight; y++) {
            for (let z = 0; z < width; z++) {
              const i = index(x, y, z);
              if (blocks[i] === EMPTY) continue;
              const value = resourceNoise.noise3d(
                (originX + x) / resource.scale.x,
                y / resource.scale.y,
                (originZ + z) / resource.scale.x
              );
              if (value > resource.scarcity) blocks[i] = resource.id;
            }
          }
        }
      }
      return { blocks, features: { waterfalls: [], biome: null } };
    },

    sampleColumn(x, z) {
      return { height: columnHeight(Math.floor(x), Math.floor(z)), biome: null, waterLevel: -1 };
    },

    findSpawn() {
      return { x: 32, z: 32 };
    },
  };
}
