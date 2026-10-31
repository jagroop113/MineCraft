import * as THREE from "three";
import {
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  BLOCK_LAYER,
  BLOCK_REFS,
  FACE_TILES,
  LAYER,
  SEE_THROUGH,
  atlasTexture,
  blocks,
  waterTexture,
} from "./blocks";
import { getGenerator } from "./terrain/generators";
import { hash2 } from "./terrain/hash";

// Every visible block face is one instance of this quad (2 triangles), so
// faces touching other blocks cost nothing to render
const faceGeometry = new THREE.PlaneGeometry(1, 1);

// Plants: two crossed quads
const plantGeometry = (() => {
  const a = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 4);
  const b = new THREE.PlaneGeometry(1, 1).rotateY(-Math.PI / 4);
  const geometry = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const merged = new Float32Array(a.attributes[name].array.length * 2);
    merged.set(a.attributes[name].array);
    merged.set(b.attributes[name].array, a.attributes[name].array.length);
    geometry.setAttribute(name, new THREE.BufferAttribute(merged, a.attributes[name].itemSize));
  }
  geometry.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + 4)]);
  return geometry;
})();

/**
 * Face order matches BoxGeometry's material order: +x, -x, +y, -y, +z, -z.
 * `elements` turn the quad (facing +z, centred on the origin) into that face of a unit block.
 */
const FACES = [
  { dir: [1, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { dir: [-1, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  { dir: [0, 1, 0], rotation: [-Math.PI / 2, 0, 0] },
  { dir: [0, -1, 0], rotation: [Math.PI / 2, 0, 0] },
  { dir: [0, 0, 1], rotation: [0, 0, 0] },
  { dir: [0, 0, -1], rotation: [0, Math.PI, 0] },
].map(({ dir, rotation }) => ({
  dir,
  elements: new THREE.Matrix4().compose(
    new THREE.Vector3(...dir).multiplyScalar(0.5),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(1, 1, 1)
  ).elements,
}));
const IDENTITY = new THREE.Matrix4().elements;

//! Shared chunk materials

/** Updated by the environment every frame: plant sway */
export const chunkUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.3, 0.1) },
};

/** Rendering options set by the graphics preset */
export const chunkRenderSettings = {
  // Share of grass / ferns drawn (flowers and mushrooms always are)
  grassDensity: 1,
};

// Picks the face's tile out of the atlas (per-instance "tile" attribute)
function useAtlas(material, extraVertex = "") {
  material.defines = { ATLAS_COLUMNS: ATLAS_COLUMNS.toFixed(1), ATLAS_ROWS: ATLAS_ROWS.toFixed(1) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = chunkUniforms.uTime;
    shader.uniforms.uWind = chunkUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float tile;\nuniform float uTime;\nuniform vec2 uWind;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
        vec2 tileUv = clamp(uv, 0.01, 0.99);
        float tileCol = mod(tile, ATLAS_COLUMNS);
        float tileRow = floor(tile / ATLAS_COLUMNS);
        vMapUv = vec2((tileCol + tileUv.x) / ATLAS_COLUMNS, 1.0 - (tileRow + 1.0 - tileUv.y) / ATLAS_ROWS);`
      )
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${extraVertex}`);
  };
  material.customProgramCacheKey = () => `atlas:${extraVertex.length}`;
  return material;
}

const opaqueMaterial = useAtlas(new THREE.MeshLambertMaterial({ map: atlasTexture, alphaTest: 0.5 }));
const plantMaterial = useAtlas(
  new THREE.MeshLambertMaterial({ map: atlasTexture, alphaTest: 0.5, side: THREE.DoubleSide }),
  // Sway with the wind, more at the top of the sprite
  `vec3 plantBase = instanceMatrix[3].xyz;
   float bend = uv.y * uv.y;
   float phase = uTime * 1.7 + plantBase.x * 0.37 + plantBase.z * 0.23;
   transformed.x += bend * (sin(phase) * 0.06 + uWind.x * 0.14);
   transformed.z += bend * (cos(phase * 0.8) * 0.05 + uWind.y * 0.14);`
);
export const waterMaterial = new THREE.MeshPhongMaterial({
  map: waterTexture,
  transparent: true,
  opacity: 0.72,
  shininess: 80,
  specular: 0x000000,
});
// Atlas UVs differ per instance, so shadows use plain (solid) depth
const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

const MESH_KINDS = {
  opaque: { geometry: faceGeometry, material: opaqueMaterial, castShadow: true, tiles: true },
  water: { geometry: faceGeometry, material: waterMaterial, castShadow: false, tiles: false },
  plant: { geometry: plantGeometry, material: plantMaterial, castShadow: false, tiles: true },
};
const KIND_OF_LAYER = [null, "opaque", "water", "plant"];

// Smallest instance buffer for a mesh; buffers double when they fill up
const MIN_CAPACITY = 64;
// Room to grow when terrain is dug into, so most edits never reallocate
const CAPACITY_HEADROOM = 1.25;

export default class WorldChunk extends THREE.Group {
  /** Block ids, indexed (x * height + y) * width + z */
  blocks = null;

  /** Generator output besides blocks (waterfall positions, biome) */
  features = { waterfalls: [], biome: null };

  /** InstancedMesh per kind ("opaque", "water", "plant"); mesh.userData.owners maps instance → key */
  meshes = {};

  /** Face key (cellIndex * 6 + face) → instance index, for every visible face */
  faceInstances = new Map();

  /** Cell index → plant instance index */
  plantInstances = new Map();

  /**
   * Set by World: block id at world coordinates outside this chunk, or
   * undefined where there is no chunk. Lets blocks on the chunk border be
   * hidden when the neighbouring chunk covers them.
   * @type {((x:number, y:number, z:number) => number | undefined) | null}
   */
  lookupOutside = null;

  constructor(size, params) {
    super();
    this.size = size;
    this.params = params
  }

  get chunkX() {
    return Math.round(this.position.x / this.size.width);
  }

  get chunkZ() {
    return Math.round(this.position.z / this.size.width);
  }

  /**
   * Generates terrain on this thread (World normally uses a worker instead).
   * @param {{x:number, y:number, z:number, id:number}[]} edits player changes (chunk coords) applied on top of the terrain
   */
  generate(edits = []) {
    const { blocks: data, features } = getGenerator(this.params, this.size).generateChunk(this.chunkX, this.chunkZ);
    this.setGeneratedData(data, features, edits);
  }

  /** Takes generated block data (from this thread or a worker), applies edits and builds meshes */
  setGeneratedData(data, features, edits = []) {
    this.blocks = data;
    this.features = features ?? { waterfalls: [], biome: null };
    for (const edit of edits) {
      this.setBlockId(edit.x, edit.y, edit.z, edit.id);
    }
    this.generateMeshes();
  }

  //! Meshing

  generateMeshes() {
    this.disposeInstances();
    this.meshes = {};
    this.faceInstances.clear();
    this.plantInstances.clear();

    const { width: w, height: h } = this.size;
    const data = this.blocks;
    const strideX = h * w;
    const lists = { opaque: [], water: [], plant: [] };

    // First pass: find every visible face, so each buffer is sized exactly once
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < w; z++) {
          const i = x * strideX + y * w + z;
          const id = data[i];
          if (id === 0) continue;
          const layer = BLOCK_LAYER[id];
          if (layer === LAYER.plant) {
            if (this.isPlantShown(x, z, id)) lists.plant.push(i);
            continue;
          }
          const list = layer === LAYER.water ? lists.water : lists.opaque;
          // Neighbour ids: inside the chunk read the array directly (fast path)
          const n0 = x < w - 1 ? data[i + strideX] : this.getNeighbourId(x + 1, y, z);
          const n1 = x > 0 ? data[i - strideX] : this.getNeighbourId(x - 1, y, z);
          const n2 = y < h - 1 ? data[i + w] : 0;
          const n3 = y > 0 ? data[i - w] : blocks.stone.id;
          const n4 = z < w - 1 ? data[i + 1] : this.getNeighbourId(x, y, z + 1);
          const n5 = z > 0 ? data[i - 1] : this.getNeighbourId(x, y, z - 1);
          if (SEE_THROUGH[n0] && n0 !== id) list.push(i * 6);
          if (SEE_THROUGH[n1] && n1 !== id) list.push(i * 6 + 1);
          if (SEE_THROUGH[n2] && n2 !== id) list.push(i * 6 + 2);
          if (SEE_THROUGH[n3] && n3 !== id) list.push(i * 6 + 3);
          if (SEE_THROUGH[n4] && n4 !== id) list.push(i * 6 + 4);
          if (SEE_THROUGH[n5] && n5 !== id) list.push(i * 6 + 5);
        }
      }
    }

    for (const kind of ["opaque", "water"]) {
      if (lists[kind].length === 0) continue;
      this.createMesh(kind, Math.ceil(lists[kind].length * CAPACITY_HEADROOM));
      for (const key of lists[kind]) this.addFaceInstance(Math.floor(key / 6), key % 6);
    }
    if (lists.plant.length > 0) {
      this.createMesh("plant", Math.ceil(lists.plant.length * CAPACITY_HEADROOM));
      for (const cell of lists.plant) this.addPlantInstance(cell);
    }
  }

  createMesh(kind, capacity) {
    const spec = MESH_KINDS[kind];
    const size = Math.max(capacity, MIN_CAPACITY);
    // Own geometry per mesh: the per-instance tile attribute lives on it
    const geometry = spec.geometry.clone();
    if (spec.tiles) geometry.setAttribute("tile", new THREE.InstancedBufferAttribute(new Float32Array(size), 1));
    const mesh = new THREE.InstancedMesh(geometry, spec.material, size);
    mesh.name = kind;
    mesh.count = 0;
    mesh.castShadow = spec.castShadow;
    mesh.receiveShadow = true;
    if (spec.castShadow) mesh.customDepthMaterial = depthMaterial;
    mesh.userData.owners = new Int32Array(size);
    // Bound the whole chunk once instead of recomputing after every edit
    mesh.boundingSphere = this.getBoundingSphere();
    this.meshes[kind] = mesh;
    this.add(mesh);
    return mesh;
  }

  getBoundingSphere() {
    if (!this.boundingSphere) {
      const { width, height } = this.size;
      this.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(width / 2 - 0.5, height / 2 - 0.5, width / 2 - 0.5),
        Math.sqrt(2 * width * width + height * height) / 2 + 1
      );
    }
    return this.boundingSphere;
  }

  /** Returns the mesh of that kind with room for at least one more instance */
  getMeshWithSpace(kind) {
    const mesh = this.meshes[kind];
    if (!mesh) return this.createMesh(kind, MIN_CAPACITY);
    if (mesh.count < mesh.instanceMatrix.count) return mesh;

    this.remove(mesh);
    const grown = this.createMesh(kind, mesh.instanceMatrix.count * 2);
    grown.instanceMatrix.array.set(mesh.instanceMatrix.array);
    grown.userData.owners.set(mesh.userData.owners);
    if (mesh.geometry.attributes.tile) grown.geometry.attributes.tile.array.set(mesh.geometry.attributes.tile.array);
    grown.count = mesh.count;
    grown.visible = mesh.visible;
    mesh.geometry.dispose();
    mesh.dispose();
    return grown;
  }

  getCellIndex(x, y, z) {
    return (x * this.size.height + y) * this.size.width + z;
  }

  #cellCoords(cell) {
    const { width, height } = this.size;
    return [Math.floor(cell / (height * width)), Math.floor(cell / width) % height, cell % width];
  }

  /** Grass and ferns are thinned by the graphics preset (deterministically per column) */
  isPlantShown(x, z, id) {
    if (chunkRenderSettings.grassDensity >= 1) return true;
    if (id !== blocks.tallGrass.id && id !== blocks.fern.id) return true;
    return hash2(7, this.position.x + x, this.position.z + z) < chunkRenderSettings.grassDensity;
  }

  /**
   * A face is drawn when the neighbour on that side lets you see it: empty
   * space or a transparent block of a different type (glass next to glass,
   * water next to water, ... hide the face between them).
   */
  isFaceVisible(x, y, z, face, blockId) {
    const [dx, dy, dz] = FACES[face].dir;
    const neighbourId = this.getNeighbourId(x + dx, y + dy, z + dz);
    return SEE_THROUGH[neighbourId] === 1 && neighbourId !== blockId;
  }

  #pushInstance(mesh, instanceId, key, elements, x, y, z, tile) {
    const array = mesh.instanceMatrix.array;
    const offset = instanceId * 16;
    array.set(elements, offset);
    array[offset + 12] += x;
    array[offset + 13] += y;
    array[offset + 14] += z;
    mesh.userData.owners[instanceId] = key;
    if (tile !== undefined) {
      mesh.geometry.attributes.tile.array[instanceId] = tile;
      mesh.geometry.attributes.tile.needsUpdate = true;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  addFaceInstance(cell, face) {
    const faceKey = cell * 6 + face;
    if (this.faceInstances.has(faceKey)) return;
    const id = this.blocks[cell];
    const kind = KIND_OF_LAYER[BLOCK_LAYER[id]];
    const mesh = this.getMeshWithSpace(kind);
    const instanceId = mesh.count++;
    const [x, y, z] = this.#cellCoords(cell);
    this.#pushInstance(mesh, instanceId, faceKey, FACES[face].elements, x, y, z, kind === "opaque" ? FACE_TILES[id * 6 + face] : undefined);
    this.faceInstances.set(faceKey, instanceId);
  }

  addPlantInstance(cell) {
    if (this.plantInstances.has(cell)) return;
    const id = this.blocks[cell];
    const mesh = this.getMeshWithSpace("plant");
    const instanceId = mesh.count++;
    const [x, y, z] = this.#cellCoords(cell);
    // Small per-plant offset so fields don't look like a grid
    const wx = this.position.x + x;
    const wz = this.position.z + z;
    const jx = (hash2(3, wx, wz) - 0.5) * 0.3;
    const jz = (hash2(4, wx, wz) - 0.5) * 0.3;
    this.#pushInstance(mesh, instanceId, cell, IDENTITY, x + jx, y, z + jz, FACE_TILES[id * 6]);
    this.plantInstances.set(cell, instanceId);
  }

  #removeInstance(mesh, map, key) {
    const instanceId = map.get(key);
    if (instanceId === undefined) return;
    const owners = mesh.userData.owners;
    const lastId = mesh.count - 1;
    if (instanceId !== lastId) {
      const array = mesh.instanceMatrix.array;
      array.copyWithin(instanceId * 16, lastId * 16, lastId * 16 + 16);
      const tiles = mesh.geometry.attributes.tile;
      if (tiles) {
        tiles.array[instanceId] = tiles.array[lastId];
        tiles.needsUpdate = true;
      }
      owners[instanceId] = owners[lastId];
      map.set(owners[lastId], instanceId);
    }
    mesh.count--;
    mesh.instanceMatrix.needsUpdate = true;
    map.delete(key);
  }

  /** Hides a face by swapping the mesh's last instance into its slot */
  removeFaceInstance(cell, face) {
    const kind = KIND_OF_LAYER[BLOCK_LAYER[this.blocks[cell]]];
    const mesh = this.meshes[kind];
    if (mesh) this.#removeInstance(mesh, this.faceInstances, cell * 6 + face);
  }

  removePlantInstance(cell) {
    if (this.meshes.plant) this.#removeInstance(this.meshes.plant, this.plantInstances, cell);
  }

  /** Re-checks visibility of the blocks on the four vertical borders of the chunk */
  refreshBorderInstances() {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.refreshBorder(dx, dz);
  }

  /** Re-checks the border facing direction (dx, dz), e.g. after a neighbour chunk loads */
  refreshBorder(dx, dz) {
    const { width, height } = this.size;
    const fixed = dx === 1 || dz === 1 ? width - 1 : 0;
    for (let y = 0; y < height; y++) {
      for (let i = 0; i < width; i++) {
        if (dx !== 0) this.refreshBlockInstance(fixed, y, i);
        else this.refreshBlockInstance(i, y, fixed);
      }
    }
  }

  /** Adds or removes instances so they match which faces are exposed */
  refreshBlockInstance(x, y, z) {
    if (!this.inBounds(x, y, z)) return;
    const cell = this.getCellIndex(x, y, z);
    const id = this.blocks[cell];
    if (id === blocks.empty.id) return;

    if (BLOCK_LAYER[id] === LAYER.plant) {
      const visible = this.isPlantShown(x, z, id);
      const shown = this.plantInstances.has(cell);
      if (visible && !shown) this.addPlantInstance(cell);
      else if (!visible && shown) this.removePlantInstance(cell);
      return;
    }
    for (let face = 0; face < 6; face++) {
      const visible = this.isFaceVisible(x, y, z, face, id);
      const shown = this.faceInstances.has(cell * 6 + face);
      if (visible && !shown) this.addFaceInstance(cell, face);
      else if (!visible && shown) this.removeFaceInstance(cell, face);
    }
  }

  /** Changes the block type at (x, y, z) and updates its own instances */
  setBlock(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    const cell = this.getCellIndex(x, y, z);
    if (this.blocks[cell] !== blocks.empty.id) {
      for (let face = 0; face < 6; face++) this.removeFaceInstance(cell, face);
      this.removePlantInstance(cell);
    }
    this.blocks[cell] = id;
    this.refreshBlockInstance(x, y, z);
  }

  /** Re-applies the plant density setting */
  rebuildPlants() {
    if (!this.blocks) return;
    for (let cell = 0; cell < this.blocks.length; cell++) {
      if (BLOCK_LAYER[this.blocks[cell]] === LAYER.plant) this.refreshBlockInstance(...this.#cellCoords(cell));
    }
  }

  setPlantsVisible(visible) {
    if (this.meshes.plant) this.meshes.plant.visible = visible;
  }

  /** Number of rendered faces of the block at (x, y, z) (1 for a shown plant) */
  getVisibleFaceCount(x, y, z) {
    const cell = this.getCellIndex(x, y, z);
    if (this.plantInstances.has(cell)) return 1;
    let count = 0;
    for (let face = 0; face < 6; face++) if (this.faceInstances.has(cell * 6 + face)) count++;
    return count;
  }

  // Helpers
  /**
   * Gets the block data at (x, y, z)
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {{id: number} | null} shared, frozen object per block type
   */
  getBlock(x, y, z) {
    if (this.inBounds(x, y, z)) {
      return BLOCK_REFS[this.blocks[(x * this.size.height + y) * this.size.width + z]];
    } else {
      return null;
    }
  }

  /** Block id at (x, y, z), or -1 outside the chunk */
  getBlockId(x, y, z) {
    if (!this.inBounds(x, y, z)) return -1;
    return this.blocks[(x * this.size.height + y) * this.size.width + z];
  }

  /**
   * Sets the block id for the block at (x, y, z)
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} id
   */
  setBlockId(x, y, z, id) {
    if (this.inBounds(x, y, z)) {
      this.blocks[(x * this.size.height + y) * this.size.width + z] = id;
    }
  }

  /**
   * Checks if the (x, y, z) coordinates are within bounds
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {boolean}
   */
  inBounds(x, y, z) {
    return (
      x >= 0 &&
      x < this.size.width &&
      y >= 0 &&
      y < this.size.height &&
      z >= 0 &&
      z < this.size.width
    );
  }

  /**
   * Block id next to this chunk's blocks, looking into neighbouring chunks.
   * Below the world counts as solid: it can never be seen from there.
   */
  getNeighbourId(x, y, z) {
    if (this.inBounds(x, y, z)) return this.blocks[(x * this.size.height + y) * this.size.width + z];
    if (y < 0) return blocks.stone.id;
    if (y >= this.size.height) return blocks.empty.id;
    return this.lookupOutside?.(this.position.x + x, y, this.position.z + z) ?? blocks.empty.id;
  }

  /** Whether no face of the block at (x, y, z) can be seen */
  isBlockHidden(x, y, z) {
    const blockId = this.getBlockId(x, y, z);
    if (blockId <= 0) return true;
    if (BLOCK_LAYER[blockId] === LAYER.plant) return false;
    for (let face = 0; face < 6; face++) {
      if (this.isFaceVisible(x, y, z, face, blockId)) return false;
    }
    return true;
  }


  //! Remove the Chunk from the world
  disposeInstances() {
    this.traverse((obj) => {
      if (obj.isInstancedMesh) obj.geometry.dispose();
      if (obj.dispose) obj.dispose();
    })
    this.clear()
  }
}
