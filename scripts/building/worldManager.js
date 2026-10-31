import * as THREE from "three";
import { isSolid } from "../blocks";
import { NATURAL_DEFAULTS } from "../terrain/naturalGenerator";
import { MAX_NAME_LENGTH, SAVE_VERSION, createSave, decodeEdits, parseSave } from "./saveFormat";

// v1 saves from the earlier localStorage slot system, imported once
const LEGACY_PREFIX = "minecraft-js:world:";
const LEGACY_SLOTS = 3;
// The original generator's settings, for "Classic" worlds
const CLASSIC_DEFAULTS = {
  terrain: { scale: 30, magnitude: 0.5, offset: 0.2 },
  biomeScale: 1,
  chunkSize: { width: 64, height: 32 },
};
// Moving further than this (in blocks) since the last save counts as unsaved progress
const PLAYER_MOVE_THRESHOLD = 1;

const _euler = new THREE.Euler(0, 0, 0, "YXZ");

function createId() {
  // randomUUID only exists in secure contexts (https / localhost)
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameTerrain(a, b) {
  return (
    a.params.seed === b.params.seed &&
    (a.params.generator ?? "classic") === (b.params.generator ?? "classic") &&
    (a.params.biomeScale ?? 1) === (b.params.biomeScale ?? 1) &&
    a.params.terrain.scale === b.params.terrain.scale &&
    a.params.terrain.magnitude === b.params.terrain.magnitude &&
    a.params.terrain.offset === b.params.terrain.offset &&
    a.chunkSize.width === b.chunkSize.width &&
    a.chunkSize.height === b.chunkSize.height
  );
}

/**
 * Owns the lifecycle of the current world: create, load, save, reset, delete
 * and autosave. Operations run one at a time so a save can never interleave
 * with a load.
 */
export class WorldManager {
  /** @type {{ id: string, name: string, createdAt: number } | null} */
  current = null;
  dirty = false;

  #queue = Promise.resolve();
  #autosaveTimer = null;
  #savedPlayerPosition = new THREE.Vector3();
  #statusListeners = new Set();
  #spawnCache = { key: null, spawn: null };

  /**
   * Extra state saved with each world (set by the game: time of day, weather).
   * save() returns the data, load(data | null) restores it.
   */
  environment = { save: () => null, load: () => {} };

  /**
   * @param {{
   *   world: import("../world").World, player: import("../player").Player,
   *   persistence: import("./worldPersistence").WorldPersistence,
   *   settings: import("./settings").Settings, storage?: Storage | null,
   * }} options
   */
  constructor({ world, player, persistence, settings, storage = globalThis.localStorage ?? null }) {
    this.world = world;
    this.player = player;
    this.persistence = persistence;
    this.settings = settings;
    this.storage = storage;
  }

  /**
   * Opens the last played world, or creates a first one.
   * @returns {Promise<string[]>} warnings to show the player
   */
  init() {
    return this.#run(async () => {
      const warnings = await this.#importLegacySaves();
      const lastId = this.settings.lastWorldId;
      if (lastId) {
        try {
          warnings.push(...(await this.#load(lastId)));
          return warnings;
        } catch (error) {
          warnings.push(`Couldn't open your last world: ${error.message}`);
        }
      }
      const worlds = await this.persistence.listWorlds();
      for (const meta of worlds) {
        try {
          warnings.push(...(await this.#load(meta.id)));
          return warnings;
        } catch {
          // Try the next world
        }
      }
      await this.#create({ name: "My World" });
      return warnings;
    });
  }

  listWorlds() {
    return this.persistence.listWorlds();
  }

  /** @param {{ name: string, seed?: number }} options */
  createWorld(options) {
    return this.#run(async () => {
      await this.#saveIfDirty();
      await this.#create(options);
    });
  }

  /** @returns {Promise<string[]>} warnings */
  loadWorld(id) {
    return this.#run(async () => {
      await this.#saveIfDirty();
      return this.#load(id);
    });
  }

  /** Removes every change in the current world and saves the fresh terrain */
  resetWorld() {
    return this.#run(async () => {
      const editedChunks = this.world.getEditedChunkKeys();
      this.world.setEdits([]);
      await this.world.generateAsync({ chunks: editedChunks });
      await this.spawnPlayer();
      await this.#save();
    });
  }

  /** Deletes a world; deleting the open one switches to another (or a new) world */
  deleteWorld(id) {
    return this.#run(async () => {
      await this.persistence.deleteWorld(id);
      if (this.current?.id !== id) return;
      this.current = null;
      this.dirty = false;
      const [next] = await this.persistence.listWorlds();
      if (next) await this.#load(next.id);
      else await this.#create({ name: "My World" });
    });
  }

  save() {
    return this.#run(() => this.#save());
  }

  markDirty() {
    this.dirty = true;
  }

  /** Block changes, or the player having moved since the last save */
  get hasUnsavedChanges() {
    if (!this.current) return false;
    return this.dirty || this.player.position.distanceTo(this.#savedPlayerPosition) > PLAYER_MOVE_THRESHOLD;
  }

  /** Saves only when something changed; used for autosave and pause / tab-hide checkpoints */
  saveIfNeeded() {
    return this.#run(() => (this.hasUnsavedChanges ? this.#save() : undefined));
  }

  /** @param {number} seconds 0 disables autosave */
  setAutosaveInterval(seconds) {
    clearInterval(this.#autosaveTimer);
    this.#autosaveTimer = null;
    if (seconds > 0) {
      this.#autosaveTimer = setInterval(() => this.saveIfNeeded().catch(() => {}), seconds * 1000);
    }
  }

  /** @param {(status: { state: "loading" | "saving" | "saved" | "error", message?: string }) => void} listener */
  onStatus(listener) {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /** The world's spawn point (a dry, scenic spot for natural worlds) */
  getSpawnPoint() {
    const key = JSON.stringify([this.world.params, this.world.chunkSize]);
    if (this.#spawnCache.key !== key) this.#spawnCache = { key, spawn: this.world.generator.findSpawn() };
    return this.#spawnCache.spawn;
  }

  /** Puts the player on the surface at the spawn point (loading that area first) */
  async spawnPlayer() {
    const spawn = this.getSpawnPoint();
    if (!this.world.isLoadedAt(spawn.x, spawn.z)) await this.world.loadAround(spawn.x, spawn.z, 1);
    const y = this.world.getSurfaceHeight(spawn.x, spawn.z);
    this.player.position.set(spawn.x + 0.5, y - 0.5 + this.player.height + 0.05, spawn.z + 0.5);
    this.player.velocity.set(0, 0, 0);
  }

  getPlayerState() {
    _euler.setFromQuaternion(this.player.camera.quaternion);
    return { position: this.player.position.toArray(), yaw: _euler.y, pitch: _euler.x };
  }

  dispose() {
    clearInterval(this.#autosaveTimer);
    this.#statusListeners.clear();
  }

  //! Internals (always run inside #run)

  #run(task) {
    const result = this.#queue.then(task);
    this.#queue = result.catch(() => {});
    return result;
  }

  #emit(status) {
    this.#statusListeners.forEach((listener) => listener(status));
  }

  /**
   * @param {{ name: string, seed?: number, generator?: "natural" | "classic", chunkWidth?: number }} options
   */
  async #create({ name, seed, generator = "natural", chunkWidth }) {
    const trimmed = String(name ?? "").trim().slice(0, MAX_NAME_LENGTH) || "New World";
    const defaults = generator === "classic" ? CLASSIC_DEFAULTS : NATURAL_DEFAULTS;
    const save = {
      version: SAVE_VERSION,
      id: createId(),
      name: trimmed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      params: {
        // Unique seeds: random unless the player typed one
        seed: Number.isFinite(seed) ? seed : Math.floor(Math.random() * 2 ** 31),
        generator,
        biomeScale: defaults.biomeScale,
        terrain: structuredClone(defaults.terrain),
      },
      chunkSize: { ...defaults.chunkSize, ...(chunkWidth ? { width: chunkWidth } : {}) },
      player: null,
      environment: null,
      edits: new Int32Array(0),
    };
    await this.#apply(save);
    await this.#save();
  }

  async #load(id) {
    this.#emit({ state: "loading" });
    const { save, warnings, recovered } = await this.persistence.loadWorld(id);
    if (recovered) warnings.unshift("The latest save was damaged, so the previous save was restored.");
    await this.#apply(save);
    // The recovered backup becomes the current save
    if (recovered) await this.#save();
    return warnings;
  }

  async #apply(save) {
    const world = this.world;
    const previouslyEdited = world.getEditedChunkKeys();
    const keepTerrain = world.children.length > 0 && sameTerrain(world, save);

    world.params.seed = save.params.seed;
    world.params.generator = save.params.generator;
    world.params.biomeScale = save.params.biomeScale;
    Object.assign(world.params.terrain, save.params.terrain);
    Object.assign(world.chunkSize, save.chunkSize);
    world.setEdits(decodeEdits(save.edits));

    // Load around where the player will stand before placing them
    const target = save.player?.position ?? null;
    const spawn = this.getSpawnPoint();
    const focus = target ? { x: target[0], z: target[2] } : { x: spawn.x, z: spawn.z };
    if (keepTerrain) {
      // Same terrain: only rebuild loaded chunks whose edits differ
      const chunks = new Set([...previouslyEdited, ...world.getEditedChunkKeys()]);
      await world.generateAsync({ chunks });
      await world.loadAround(focus.x, focus.z, 1);
    } else {
      await world.generateAsync({ center: focus });
    }

    this.current = { id: save.id, name: save.name, createdAt: save.createdAt };
    this.dirty = false;
    this.settings.lastWorldId = save.id;
    this.settings.save();
    await this.#restorePlayer(save.player);
    this.environment.load(save.environment ?? null);
    this.#savedPlayerPosition.copy(this.player.position);
  }

  async #restorePlayer(state) {
    if (!state || !this.#isFreeSpace(state.position)) {
      await this.spawnPlayer();
      return;
    }
    this.player.position.fromArray(state.position);
    this.player.velocity.set(0, 0, 0);
    this.player.camera.quaternion.setFromEuler(_euler.set(state.pitch, state.yaw, 0));
  }

  // Whether the player's body at this eye position is inside the world and not inside a block
  #isFreeSpace([x, y, z]) {
    const { height } = this.world.bounds;
    if (!this.world.isLoadedAt(x, z) || y < 0 || y > height + 50) return false;
    const bx = Math.round(x);
    const bz = Math.round(z);
    for (let by = Math.round(y - this.player.height); by <= Math.round(y); by++) {
      const block = this.world.getBlock(bx, by, bz);
      if (block && isSolid(block.id)) return false;
    }
    return true;
  }

  async #save() {
    if (!this.current) return;
    this.#emit({ state: "saving" });
    try {
      const save = createSave({
        ...this.current,
        world: this.world,
        player: this.getPlayerState(),
        environment: this.environment.save(),
      });
      await this.persistence.saveWorld(save);
      this.dirty = false;
      this.#savedPlayerPosition.fromArray(save.player.position);
      this.#emit({ state: "saved" });
    } catch (error) {
      this.#emit({ state: "error", message: error.message });
      throw error;
    }
  }

  async #saveIfDirty() {
    if (this.hasUnsavedChanges) await this.#save().catch(() => {});
  }

  async #importLegacySaves() {
    const warnings = [];
    if (!this.storage) return warnings;
    for (let slot = 0; slot < LEGACY_SLOTS; slot++) {
      const key = `${LEGACY_PREFIX}${slot}`;
      let raw;
      try {
        raw = this.storage.getItem(key);
      } catch {
        return warnings;
      }
      if (raw === null) continue;
      try {
        const data = JSON.parse(raw);
        const { save } = parseSave({ ...data, id: `legacy-slot-${slot + 1}`, name: `Slot ${slot + 1} (imported)` });
        await this.persistence.saveWorld(save);
        this.storage.removeItem(key);
      } catch (error) {
        // Keep the data (never silently destroy a save) but stop retrying every start
        try {
          this.storage.setItem(`minecraft-js:unreadable-world:${slot}`, raw);
          this.storage.removeItem(key);
        } catch {
          // Storage unavailable; the import will simply be retried next time
        }
        warnings.push(`Old save slot ${slot + 1} couldn't be imported: ${error.message}`);
      }
    }
    return warnings;
  }
}
