import * as THREE from "three";
import { SOLID, blocks } from "../blocks";

/**
 * Walks the block grid along a ray (Amanatides & Woo voxel traversal) and
 * returns the first non-empty block. Cost depends on the distance, not on
 * how many blocks exist, unlike raycasting every InstancedMesh instance.
 *
 * Blocks are unit cubes centred on integer coordinates.
 *
 * @param {import("../world").World} world
 * @param {THREE.Ray} ray direction must be normalized
 * @param {number} maxDistance
 * @param {RaycastHit} [hit] object to write the result into (avoids per-frame allocations)
 * @returns {RaycastHit | null}
 */
export function raycastBlocks(world, ray, maxDistance, hit = createRaycastHit()) {
  const { origin, direction } = ray;

  // Shift by half a block so that floor() gives the cell index
  const ox = origin.x + 0.5;
  const oy = origin.y + 0.5;
  const oz = origin.z + 0.5;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = Math.sign(direction.x);
  const stepY = Math.sign(direction.y);
  const stepZ = Math.sign(direction.z);

  // Distance along the ray to cross one whole cell on each axis
  const tDeltaX = stepX !== 0 ? Math.abs(1 / direction.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / direction.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / direction.z) : Infinity;

  // Distance along the ray to the first cell boundary on each axis
  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;

  const normal = hit.normal.set(0, 0, 0);
  let t = 0;
  // From inside water (swimming), look through it like air
  const underwater = world.getBlock(x, y, z)?.id === blocks.water.id;

  while (t <= maxDistance) {
    const block = world.getBlock(x, y, z);
    const id = block?.id ?? blocks.empty.id;
    // The cell the eye is in only counts if solid (not a plant or water around the head)
    const skip = id === blocks.empty.id || (t === 0 && !SOLID[id]) || (underwater && id === blocks.water.id);
    if (!skip) {
      hit.position.set(x, y, z);
      hit.block = block;
      hit.distance = t;
      return hit;
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal.set(-stepX, 0, 0);
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal.set(0, -stepY, 0);
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal.set(0, 0, -stepZ);
    }
  }

  return null;
}

/**
 * @typedef {{position: THREE.Vector3, normal: THREE.Vector3, block: {id:number} | null, distance: number}} RaycastHit
 */
export function createRaycastHit() {
  return { position: new THREE.Vector3(), normal: new THREE.Vector3(), block: null, distance: 0 };
}
