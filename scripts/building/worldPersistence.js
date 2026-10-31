import { SaveDataError, describeSave, parseSave } from "./saveFormat";

//! World storage. Saves go to IndexedDB (worlds can hold many thousands of
//! edits); each save keeps the previous one as a backup to recover from.

const DB_NAME = "minecraft-js";
const DB_VERSION = 1;
// worlds: current save per world, backups: previous save, meta: list summaries
const STORES = ["worlds", "backups", "meta"];

/** Key/value stores backed by IndexedDB; all writes in one call are atomic */
export class IndexedDbBackend {
  #db;

  static async open(indexedDB = globalThis.indexedDB) {
    if (!indexedDB) throw new Error("IndexedDB is not available");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        for (const store of STORES) {
          if (!request.result.objectStoreNames.contains(store)) {
            request.result.createObjectStore(store, { keyPath: "id" });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Storage is blocked by another open tab"));
    });
    return new IndexedDbBackend(db);
  }

  constructor(db) {
    this.#db = db;
  }

  get(store, id) {
    return this.#request(store, "readonly", (s) => s.get(id));
  }

  getAll(store) {
    return this.#request(store, "readonly", (s) => s.getAll());
  }

  /** @param {{store: string, value?: object, deleteId?: string}[]} operations */
  write(operations) {
    const stores = [...new Set(operations.map((op) => op.store))];
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(stores, "readwrite");
      for (const op of operations) {
        const store = tx.objectStore(op.store);
        if (op.deleteId !== undefined) store.delete(op.deleteId);
        else store.put(op.value);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Save was aborted (storage full?)"));
    });
  }

  #request(store, mode, makeRequest) {
    return new Promise((resolve, reject) => {
      const request = makeRequest(this.#db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

/** Same interface, kept in memory: used in tests and when IndexedDB is unavailable */
export class MemoryBackend {
  #stores = new Map(STORES.map((store) => [store, new Map()]));

  async get(store, id) {
    return structuredClone(this.#stores.get(store).get(id));
  }

  async getAll(store) {
    return [...this.#stores.get(store).values()].map((value) => structuredClone(value));
  }

  async write(operations) {
    for (const op of operations) {
      const store = this.#stores.get(op.store);
      if (op.deleteId !== undefined) store.delete(op.deleteId);
      else store.set(op.value.id, structuredClone(op.value));
    }
  }
}

export class WorldPersistence {
  /** @param {IndexedDbBackend | MemoryBackend} backend */
  constructor(backend) {
    this.backend = backend;
    this.persistent = backend instanceof IndexedDbBackend;
  }

  /** Opens IndexedDB, falling back to memory (saves then last only for this session) */
  static async open() {
    try {
      return new WorldPersistence(await IndexedDbBackend.open());
    } catch (error) {
      console.warn("World saving unavailable, using memory storage:", error);
      return new WorldPersistence(new MemoryBackend());
    }
  }

  /** @returns summaries of all saved worlds, most recently played first */
  async listWorlds() {
    const meta = await this.backend.getAll("meta");
    return meta.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Stores a save after validating it, moving the previous valid save to backups.
   * Never writes data that wouldn't load again.
   */
  async saveWorld(save) {
    const { save: valid } = parseSave(save);
    const operations = [];

    const previous = await this.backend.get("worlds", valid.id);
    if (previous && this.#isLoadable(previous)) {
      operations.push({ store: "backups", value: previous });
    }
    operations.push({ store: "worlds", value: valid }, { store: "meta", value: describeSave(valid) });
    await this.backend.write(operations);
    return valid;
  }

  /**
   * Loads a world, falling back to its backup when the latest save is corrupted.
   * @returns {Promise<{ save: object, warnings: string[], recovered: boolean }>}
   */
  async loadWorld(id) {
    let firstError;
    for (const store of ["worlds", "backups"]) {
      const raw = await this.backend.get(store, id);
      if (!raw) continue;
      try {
        const { save, warnings } = parseSave(raw);
        return { save, warnings, recovered: store === "backups" };
      } catch (error) {
        firstError ??= error;
      }
    }
    throw firstError ?? new SaveDataError("World not found.");
  }

  async deleteWorld(id) {
    await this.backend.write(STORES.map((store) => ({ store, deleteId: id })));
  }

  #isLoadable(raw) {
    try {
      parseSave(raw);
      return true;
    } catch {
      return false;
    }
  }
}
