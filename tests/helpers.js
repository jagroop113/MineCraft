import * as THREE from "three";
import { BLOCK_LAYER, FACE_TILES } from "../scripts/blocks";
import { World } from "../scripts/world";

/** A small world (9 chunks of 16x32x16) so tests generate quickly */
export function createTestWorld() {
  const world = new World();
  world.chunkSize.width = 16;
  world.chunkSize.height = 32;
  world.generate();
  return world;
}

/** Stand-in for Player: the parts game logic uses, without DOM / pointer lock */
export function createTestPlayer() {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
  return {
    camera,
    radius: 0.5,
    height: 1.75,
    velocity: new THREE.Vector3(),
    controls: { isLocked: true },
    get position() {
      return camera.position;
    },
    clearInput() {},
  };
}

/**
 * Checks the rendering state of every chunk: each instance belongs to a
 * visible face (or plant) of a block in the right layer, sits in the right
 * place with the right atlas tile, and every visible face has one instance.
 */
export function findRenderingMismatches(world) {
  const problems = [];
  const position = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (const chunk of world.children) {
    const { width, height } = chunk.size;
    const decode = (cell) => [Math.floor(cell / (height * width)), Math.floor(cell / width) % height, cell % width];

    let faceInstances = 0;
    for (const [kind, mesh] of Object.entries(chunk.meshes)) {
      for (let i = 0; i < mesh.count; i++) {
        const owner = mesh.userData.owners[i];
        const isPlant = kind === "plant";
        const cell = isPlant ? owner : Math.floor(owner / 6);
        const face = isPlant ? 0 : owner % 6;
        const [x, y, z] = decode(cell);
        const id = chunk.getBlockId(x, y, z);
        const layer = ["none", "opaque", "water", "plant"][BLOCK_LAYER[id]];
        if (layer !== kind) problems.push(`${kind} instance on ${layer} block at ${x},${y},${z}`);
        const index = isPlant ? chunk.plantInstances.get(cell) : chunk.faceInstances.get(owner);
        if (index !== i) problems.push(`index out of sync for ${kind}/${i}`);
        mesh.getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix).sub(new THREE.Vector3(x, y, z));
        const expected = isPlant ? Math.hypot(position.x, position.z) <= 0.22 && position.y === 0 : Math.abs(position.length() - 0.5) < 1e-6;
        if (!expected) problems.push(`${kind} ${face} of ${x},${y},${z} misplaced`);
        const tiles = mesh.geometry.attributes.tile;
        if (tiles && tiles.array[i] !== FACE_TILES[id * 6 + face]) problems.push(`wrong tile at ${x},${y},${z}`);
        if (!isPlant) faceInstances++;
      }
    }
    if (faceInstances !== chunk.faceInstances.size) problems.push(`${faceInstances} instances vs ${chunk.faceInstances.size} indexed faces`);

    for (let x = 0; x < width; x++)
      for (let y = 0; y < height; y++)
        for (let z = 0; z < width; z++) {
          const id = chunk.getBlockId(x, y, z);
          if (id === 0) continue;
          const cell = chunk.getCellIndex(x, y, z);
          if (BLOCK_LAYER[id] === 3) {
            if (chunk.isPlantShown(x, z, id) !== chunk.plantInstances.has(cell)) problems.push(`plant at ${x},${y},${z}`);
            continue;
          }
          for (let face = 0; face < 6; face++) {
            const shouldShow = chunk.isFaceVisible(x, y, z, face, id);
            const shown = chunk.faceInstances.has(cell * 6 + face);
            if (shouldShow !== shown) problems.push(`face ${face} at ${x},${y},${z}: expected ${shouldShow}`);
          }
        }
  }
  return problems.slice(0, 10);
}

/** In-memory localStorage replacement */
export class MemoryStorage {
  #items = new Map();
  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }
  setItem(key, value) {
    this.#items.set(key, String(value));
  }
  removeItem(key) {
    this.#items.delete(key);
  }
  keys() {
    return [...this.#items.keys()];
  }
}
