import * as THREE from "three";
import { BLOCK_REFS } from "./blocks";
import { getGenerator, snapshotResources } from "./terrain/generators";
import WorldChunk from "./worldChunk";

const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Chunk coordinates packed into one number (fast Map keys, valid up to ±32767 chunks)
const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

/**
 * Endless chunked world. Chunks within `drawDistance` of the player are
 * generated (in Web Workers when available), meshed a few per frame and
 * unloaded when far away. Player edits live in `edits`, independent of the
 * loaded chunks, so they survive unloading and are re-applied on reload.
 */
export class World extends THREE.Group {
  params = {
    seed: 0,
    terrain: {
      scale: 30,
      magnitude: 0.5,
      offset: 0.2,
    },
  };
  chunkSize = { width: 64, height: 32 };
  chunk;
  /** Radius (in chunks) kept loaded around the player */
  drawDistance = 1;
  /** Radius (in chunks) within which plants are drawn */
  plantDistance = Infinity;
  /** Main-thread time per frame for building chunk meshes */
  meshBudgetMs = 6;
  /** Chunk centre the world streams around */
  center = { x: 0, z: 0 };
  /** Player changes on top of the generated terrain, "x,y,z" -> block id */
  edits = new Map();

  #chunks = new Map();
  #lastChunk = null;
  #editIndex = new Map(); // chunk key -> Map("x,y,z" local -> {x, y, z, id})
  #requested = new Map(); // chunk key -> epoch
  #ready = [];
  #epoch = 0;
  #workers = null;
  #jobs = new Map();
  #jobCounter = 0;
  #visibleCache = { key: null, chunks: [] };

  constructor(seed = 0) {
    super();
    this.seed = seed;
  }

  get generator() {
    return getGenerator(this.params, this.chunkSize);
  }

  /** Synchronously (re)builds the 3x3 chunks around the centre; the rest streams in */
  generate() {
    this.#reset();
    for (const { x, z } of this.getChunkCoords()) {
      this.createChunk(x, z);
    }
  }

  /**
   * Rebuilds the world without blocking the page for long.
   *
   * @param {{ chunks?: Set<string>, center?: {x: number, z: number} }} options
   *   `chunks` ("x,z" keys): only rebuild those loaded chunks (terrain unchanged, edits changed);
   *   otherwise everything is discarded and the area around `center` (world coordinates) is loaded
   */
  async generateAsync({ chunks, center } = {}) {
    if (chunks) {
      for (const key of chunks) {
        const [x, z] = key.split(",").map(Number);
        const chunk = this.getChunk(x, z);
        if (!chunk) continue;
        chunk.generate(this.#localEdits(x, z));
        this.#refreshNeighbours(x, z);
        await new Promise((resolve) => setTimeout(resolve));
      }
      return;
    }
    this.#reset();
    const target = center ?? { x: (this.center.x + 0.5) * this.chunkSize.width, z: (this.center.z + 0.5) * this.chunkSize.width };
    await this.loadAround(target.x, target.z, 1);
  }

  /** 3x3 chunk coordinates around the centre */
  getChunkCoords() {
    const coords = [];
    for (let x = this.center.x - 1; x <= this.center.x + 1; x++) {
      for (let z = this.center.z - 1; z <= this.center.z + 1; z++) {
        coords.push({ x, z });
      }
    }
    return coords;
  }

  /** Generates and adds one chunk on this thread */
  createChunk(x, z) {
    const { blocks, features } = this.generator.generateChunk(x, z);
    return this.#addChunk(x, z, blocks, features);
  }

  /** World-space extents of the block grid: x/z are unbounded, y in [0, height) */
  get bounds() {
    return { min: -Infinity, max: Infinity, height: this.chunkSize.height };
  }

  /** @returns {number} y just above the highest solid block at (x, z), 0 if none */
  getSurfaceHeight(x, z) {
    x = Math.floor(x);
    z = Math.floor(z);
    for (let y = this.chunkSize.height - 1; y >= 0; y--) {
      if (this.getBlockId(x, y, z) > 0) return y + 1;
    }
    return 0;
  }

  /** Whether the chunk containing world position (x, z) is loaded */
  isLoadedAt(x, z) {
    const w = this.chunkSize.width;
    return this.getChunk(Math.floor(x / w), Math.floor(z / w)) !== undefined;
  }

  getBlock(x, y, z) {
    const id = this.getBlockId(x, y, z);
    return id < 0 ? null : BLOCK_REFS[id];
  }

  /** Block id at world coordinates, or -1 where no chunk is loaded / outside the height */
  getBlockId(x, y, z) {
    const { width: w, height: h } = this.chunkSize;
    if (y < 0 || y >= h) return -1;
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const cx = Math.floor(x / w);
    const cz = Math.floor(z / w);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return -1;
    return chunk.blocks[((x - cx * w) * h + y) * w + (z - cz * w)];
  }

  /**
   * Places (or with id 0, removes) a block at world coordinates
   * @returns {boolean} false when the position is outside the loaded world
   */
  setBlock(x, y, z, id) {
    const coords = this.worldToChunkCoords(x, y, z);
    const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);
    if (!chunk || !chunk.inBounds(coords.block.x, coords.block.y, coords.block.z)) {
      return false;
    }

    chunk.setBlock(coords.block.x, coords.block.y, coords.block.z, id);
    this.edits.set(`${x},${y},${z}`, id);
    this.#indexEdit(coords.chunk.x, coords.chunk.z, { ...coords.block, id });

    // Neighbours may have become exposed or covered, even across chunk borders
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const n = this.worldToChunkCoords(x + dx, y + dy, z + dz);
      this.getChunk(n.chunk.x, n.chunk.z)?.refreshBlockInstance(n.block.x, n.block.y, n.block.z);
    }
    return true;
  }

  /** @returns {number[][]} edits as [x, y, z, id] (for saving) */
  getEdits() {
    return Array.from(this.edits, ([key, id]) => [...key.split(",").map(Number), id]);
  }

  /** Replaces all edits; call generate() / generateAsync() afterwards to rebuild the world */
  setEdits(edits) {
    this.edits = new Map(edits.map(([x, y, z, id]) => [`${x},${y},${z}`, id]));
    this.#editIndex.clear();
    for (const [x, y, z, id] of edits) {
      const coords = this.worldToChunkCoords(x, y, z);
      this.#indexEdit(coords.chunk.x, coords.chunk.z, { ...coords.block, id });
    }
  }

  /** "x,z" keys of the chunks that contain at least one edit */
  getEditedChunkKeys() {
    return new Set(this.getEditsByChunk().keys());
  }

  getEditsByChunk() {
    const editsByChunk = new Map();
    for (const [key, edits] of this.#editIndex) {
      const cx = Math.floor(key / 65536) - 32768;
      const cz = (key % 65536) - 32768;
      editsByChunk.set(`${cx},${cz}`, [...edits.values()]);
    }
    return editsByChunk;
  }

  /** Waterfalls of the loaded chunks within `radius` blocks of (x, z) */
  getWaterfallsNear(x, z, radius) {
    const found = [];
    for (const chunk of this.#chunks.values()) {
      for (const fall of chunk.features.waterfalls) {
        if (Math.abs(fall.x - x) <= radius && Math.abs(fall.z - z) <= radius) found.push(fall);
      }
    }
    return found;
  }

  //! Streaming

  /** Loads chunks around the player, unloads far ones and meshes finished chunks */
  update(player){
    const w = this.chunkSize.width;
    this.center = { x: Math.floor(player.position.x / w), z: Math.floor(player.position.z / w) };

    const keepRadius = this.drawDistance + 1.5;
    for (const chunk of this.#chunks.values()) {
      const dx = chunk.chunkX - this.center.x;
      const dz = chunk.chunkZ - this.center.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > keepRadius) this.#unload(chunk);
      else chunk.setPlantsVisible(distance <= this.plantDistance);
    }
    // Requests for chunks that are now too far are dropped when they arrive
    for (const key of this.#requested.keys()) {
      if (this.#chunks.has(key)) continue;
      const cx = Math.floor(key / 65536) - 32768;
      const cz = (key % 65536) - 32768;
      if (Math.hypot(cx - this.center.x, cz - this.center.z) > keepRadius) this.#requested.delete(key);
    }

    // The wanted set only changes when the player enters another chunk (cached per centre)
    const visibleKey = `${this.center.x},${this.center.z},${this.drawDistance}`;
    if (this.#visibleCache.key !== visibleKey) this.#visibleCache = { key: visibleKey, chunks: this.getVisibleChunks(player) };
    const inFlight = this.#requested.size - this.#ready.length;
    const limit = this.#useWorkers() ? this.#workerPool().length * 2 : 1;
    if (inFlight < limit) {
      const toAdd = this.getChunkstoAdd(this.#visibleCache.chunks);
      for (const { x, z } of toAdd.slice(0, Math.max(0, limit - inFlight))) this.#request(x, z);
    }

    this.#processReady(this.meshBudgetMs);
  }

  /** Chunk coordinates within the draw distance, nearest first */
  getVisibleChunks(player){
    const visibleChunks=[]

    let coords=this.worldToChunkCoords(player.position.x,player.position.y,player.position.z);

    const chunkX=coords.chunk.x
    const chunkZ=coords.chunk.z
    const radius = this.drawDistance + 0.5;

    for (let x = chunkX - this.drawDistance; x <= chunkX + this.drawDistance; x++) {
      for (let z = chunkZ - this.drawDistance; z <= chunkZ + this.drawDistance; z++) {
        const distance = Math.hypot(x - chunkX, z - chunkZ);
        if (distance <= radius) visibleChunks.push({ x, z, distance });
      }
    }
    return visibleChunks.sort((a, b) => a.distance - b.distance)
  }

  /** The visible chunks that are neither loaded nor being generated */
  getChunkstoAdd(visibleChunks){
    return visibleChunks.filter(({ x, z }) => !this.#requested.has(chunkKey(x, z)) && !this.#chunks.has(chunkKey(x, z)));
  }

  /** Loads every chunk within `radius` chunks of world position (x, z) and waits for them */
  async loadAround(x, z, radius = 1) {
    const w = this.chunkSize.width;
    this.center = { x: Math.floor(x / w), z: Math.floor(z / w) };
    const coords = this.getVisibleChunks({ position: { x, y: 0, z } }).filter((c) => c.distance <= radius + 0.5);
    const epoch = this.#epoch;
    for (;;) {
      if (this.#epoch !== epoch) return;
      for (const c of coords) {
        const key = chunkKey(c.x, c.z);
        if (!this.#chunks.has(key) && !this.#requested.has(key)) this.#request(c.x, c.z);
      }
      this.#processReady(Infinity);
      if (coords.every((c) => this.#chunks.has(chunkKey(c.x, c.z)))) return;
      await new Promise((resolve) => setTimeout(resolve, this.#useWorkers() ? 5 : 0));
    }
  }

  get loadedChunkCount() {
    return this.#chunks.size;
  }

  get pendingChunkCount() {
    return this.#requested.size;
  }

  getChunk(chunkX, chunkZ) {
    const last = this.#lastChunk;
    if (last && last.chunkX === chunkX && last.chunkZ === chunkZ) return last;
    const chunk = this.#chunks.get(chunkKey(chunkX, chunkZ));
    if (chunk) this.#lastChunk = chunk;
    return chunk;
  }

  worldToChunkCoords(x, y, z) {
    const chunkCoords = {
      x: Math.floor(x / this.chunkSize.width),
      z: Math.floor(z / this.chunkSize.width),
    };
    const blockCoords = {
      x: x - chunkCoords.x * this.chunkSize.width,
      y,
      z: z - chunkCoords.z * this.chunkSize.width,
    };
    return { chunk: chunkCoords, block: blockCoords };
  }

  /** A chunk can only hide its border blocks once its neighbours exist, so borders are re-checked */
  refreshChunkBorders() {
    for (const chunk of this.#chunks.values()) chunk.refreshBorderInstances();
  }

  disposeChunk() {
    this.traverse((chunk) => {
      if (chunk.disposeInstances) {
        chunk.disposeInstances();
      }
    });
    this.clear();
    this.#chunks.clear();
    this.#lastChunk = null;
  }

  /** Stops the generation workers (the world can't stream afterwards) */
  dispose() {
    this.disposeChunk();
    this.#workers?.forEach((worker) => worker.terminate());
    this.#workers = [];
  }

  //! Internals

  #reset() {
    this.#epoch++;
    this.disposeChunk();
    this.#requested.clear();
    this.#ready.length = 0;
  }

  #addChunk(cx, cz, blocks, features) {
    const key = chunkKey(cx, cz);
    const existing = this.#chunks.get(key);
    if (existing) this.#unload(existing);
    const chunk = new WorldChunk({ ...this.chunkSize }, this.params);
    chunk.position.set(cx * this.chunkSize.width, 0, cz * this.chunkSize.width);
    chunk.userData = { x: cx, z: cz };
    chunk.lookupOutside = (wx, wy, wz) => {
      const id = this.getBlockId(wx, wy, wz);
      return id < 0 ? undefined : id;
    };
    chunk.setGeneratedData(blocks, features, this.#localEdits(cx, cz));
    this.add(chunk);
    this.#chunks.set(key, chunk);
    this.#requested.delete(key);
    this.#refreshNeighbours(cx, cz);
    return chunk;
  }

  // Neighbours treated this chunk as open air until now
  #refreshNeighbours(cx, cz) {
    for (const [dx, , dz] of NEIGHBOURS) {
      if (dx === 0 && dz === 0) continue;
      this.getChunk(cx + dx, cz + dz)?.refreshBorder(-dx, -dz);
    }
  }

  #unload(chunk) {
    chunk.disposeInstances();
    this.remove(chunk);
    this.#chunks.delete(chunkKey(chunk.chunkX, chunk.chunkZ));
    if (this.#lastChunk === chunk) this.#lastChunk = null;
    // Neighbours now border open air again
    this.#refreshNeighbours(chunk.chunkX, chunk.chunkZ);
  }

  #indexEdit(cx, cz, edit) {
    const key = chunkKey(cx, cz);
    if (!this.#editIndex.has(key)) this.#editIndex.set(key, new Map());
    this.#editIndex.get(key).set(`${edit.x},${edit.y},${edit.z}`, edit);
  }

  #localEdits(cx, cz) {
    return [...(this.#editIndex.get(chunkKey(cx, cz))?.values() ?? [])];
  }

  #useWorkers() {
    return this.#workerPool().length > 0;
  }

  #workerPool() {
    if (this.#workers) return this.#workers;
    this.#workers = [];
    if (typeof Worker === "undefined") return this.#workers;
    const count = Math.min(3, Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL("./terrain/terrainWorker.js", import.meta.url), { type: "module" });
        worker.onmessage = ({ data }) => this.#onWorkerResult(data);
        worker.onerror = (event) => {
          console.warn("Terrain worker failed, generating on the main thread:", event.message);
          this.#workers.forEach((w) => w.terminate());
          this.#workers = [];
          this.#requeueJobs();
        };
        this.#workers.push(worker);
      }
    } catch (error) {
      console.warn("Terrain workers unavailable:", error);
      this.#workers = [];
    }
    return this.#workers;
  }

  #request(cx, cz) {
    const key = chunkKey(cx, cz);
    this.#requested.set(key, this.#epoch);
    const workers = this.#workerPool();
    if (workers.length === 0) {
      const { blocks, features } = this.generator.generateChunk(cx, cz);
      this.#ready.push({ key, cx, cz, blocks, features, epoch: this.#epoch });
      return;
    }
    const jobId = ++this.#jobCounter;
    this.#jobs.set(jobId, { key, cx, cz, epoch: this.#epoch });
    workers[jobId % workers.length].postMessage({
      jobId,
      chunkX: cx,
      chunkZ: cz,
      params: structuredClone(this.params),
      size: { ...this.chunkSize },
      resources: snapshotResources(),
    });
  }

  #onWorkerResult({ jobId, blocks, features, error }) {
    const job = this.#jobs.get(jobId);
    this.#jobs.delete(jobId);
    if (!job || job.epoch !== this.#epoch || this.#requested.get(job.key) !== job.epoch) return;
    if (error) {
      console.warn("Chunk generation failed in worker, retrying on the main thread:", error);
      ({ blocks, features } = this.generator.generateChunk(job.cx, job.cz));
    }
    this.#ready.push({ ...job, blocks, features });
  }

  #requeueJobs() {
    const jobs = [...this.#jobs.values()];
    this.#jobs.clear();
    for (const job of jobs) if (job.epoch === this.#epoch) this.#request(job.cx, job.cz);
  }

  #processReady(budgetMs) {
    const start = performance.now();
    let processed = 0;
    while (this.#ready.length > 0 && (processed === 0 || performance.now() - start < budgetMs)) {
      const item = this.#ready.shift();
      if (item.epoch !== this.#epoch || this.#requested.get(item.key) !== item.epoch) continue;
      this.#addChunk(item.cx, item.cz, item.blocks, item.features);
      processed++;
    }
  }
}
