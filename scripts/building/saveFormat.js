import { isValidBlockId } from "../blocks";

//! Versioned save schema: encoding, migration and validation of world saves.
//! Saves hold logical data only (settings, player, block edits), never Three.js objects.

export const SAVE_VERSION = 3;
export const GENERATORS = ["classic", "natural"];
export const WEATHER_TYPES = ["clear", "cloudy", "rain", "thunderstorm", "snow", "fog"];
// Edits may be anywhere in the endless world, within what an Int32Array holds comfortably
const MAX_COORDINATE = 2 ** 30;
export const MAX_NAME_LENGTH = 40;

/** Thrown when save data can't be used at all */
export class SaveDataError extends Error {
  name = "SaveDataError";
}

/**
 * Save schema v3:
 * {
 *   version: 3,
 *   id: string, name: string, createdAt: number, updatedAt: number,
 *   params: { seed: number, generator: "classic" | "natural", biomeScale: number,
 *             terrain: { scale, magnitude, offset } },
 *   chunkSize: { width: number, height: number },
 *   player: { position: [x, y, z], yaw: number, pitch: number } | null,
 *   environment: { time: number (0-1, 0.5 = noon), weather: string } | null,
 *   edits: Int32Array   // flat [x, y, z, blockId, x, y, z, blockId, ...]
 * }
 */
export function createSave({ id, name, createdAt, world, player, environment = null }) {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    id,
    name,
    createdAt: createdAt ?? now,
    updatedAt: now,
    params: structuredClone(world.params),
    chunkSize: { ...world.chunkSize },
    player,
    environment,
    edits: encodeEdits(world.getEdits()),
  };
}

/** @param {number[][]} edits [x, y, z, id] tuples */
export function encodeEdits(edits) {
  const flat = new Int32Array(edits.length * 4);
  edits.forEach((edit, i) => flat.set(edit, i * 4));
  return flat;
}

/** @returns {number[][]} [x, y, z, id] tuples */
export function decodeEdits(flat) {
  const edits = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    edits.push([flat[i], flat[i + 1], flat[i + 2], flat[i + 3]]);
  }
  return edits;
}

/** Upgrades older save versions to the current schema */
export function migrateSave(raw) {
  if (raw.version === SAVE_VERSION) return raw;

  if (raw.version === 2) {
    // v2 worlds were all made with the original (classic) terrain generator
    return {
      ...raw,
      version: SAVE_VERSION,
      params: raw.params && { ...raw.params, generator: "classic", biomeScale: 1 },
      environment: null,
    };
  }

  if (raw.version === 1) {
    // v1 (localStorage slots): player was a bare position, edits nested arrays, no id/name
    return migrateSave({
      version: 2,
      id: raw.id,
      name: raw.name,
      createdAt: raw.savedAt,
      updatedAt: raw.savedAt,
      params: raw.params,
      chunkSize: raw.chunkSize,
      player: Array.isArray(raw.player) ? { position: raw.player, yaw: 0, pitch: 0 } : null,
      edits: Array.isArray(raw.edits) ? raw.edits.flat() : raw.edits,
    });
  }

  if (typeof raw.version === "number" && raw.version > SAVE_VERSION) {
    throw new SaveDataError("This world was saved by a newer version of the game.");
  }
  throw new SaveDataError("Unknown save format.");
}

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function inRange(value, min, max) {
  return isFiniteNumber(value) && value >= min && value <= max;
}

/**
 * Validates (and migrates) untrusted save data.
 * Structural problems throw SaveDataError; individual bad block edits are
 * dropped and reported in `warnings` so one bad entry doesn't lose a world.
 *
 * @returns {{ save: object, warnings: string[] }}
 */
export function parseSave(raw) {
  if (!raw || typeof raw !== "object") throw new SaveDataError("Save data is empty or not an object.");
  const data = migrateSave(raw);
  const warnings = [];

  if (typeof data.id !== "string" || data.id.length === 0) throw new SaveDataError("Save has no id.");

  const { params, chunkSize } = data;
  const generator = params?.generator ?? "classic";
  const biomeScale = params?.biomeScale ?? 1;
  if (!GENERATORS.includes(generator) || !inRange(biomeScale, 0.25, 4)) {
    throw new SaveDataError("Save has an unknown world type.");
  }
  if (
    !params ||
    !isFiniteNumber(params.seed) ||
    !inRange(params.terrain?.scale, 1, 1000) ||
    !inRange(params.terrain?.magnitude, 0, 1) ||
    !inRange(params.terrain?.offset, 0, 1)
  ) {
    throw new SaveDataError("Save has invalid terrain settings.");
  }
  if (
    !chunkSize ||
    !Number.isInteger(chunkSize.width) ||
    !Number.isInteger(chunkSize.height) ||
    !inRange(chunkSize.width, 8, 128) ||
    !inRange(chunkSize.height, 1, 64)
  ) {
    throw new SaveDataError("Save has an invalid world size.");
  }

  const flat = data.edits;
  const isNumberList = flat instanceof Int32Array || (Array.isArray(flat) && flat.every(Number.isInteger));
  if (!isNumberList || flat.length % 4 !== 0) throw new SaveDataError("Save has corrupted block data.");

  // Keep only edits inside the world height with known block ids
  const { width, height } = chunkSize;
  const edits = decodeEdits(flat).filter(([x, y, z, id]) => {
    return Math.abs(x) < MAX_COORDINATE && Math.abs(z) < MAX_COORDINATE && y >= 0 && y < height && isValidBlockId(id);
  });
  const skipped = flat.length / 4 - edits.length;
  if (skipped > 0) warnings.push(`${skipped} invalid block change(s) were skipped.`);

  const position = data.player?.position;
  const player =
    Array.isArray(position) && position.length === 3 && position.every(isFiniteNumber)
      ? {
          position: [...position],
          yaw: isFiniteNumber(data.player.yaw) ? data.player.yaw : 0,
          pitch: isFiniteNumber(data.player.pitch) ? data.player.pitch : 0,
        }
      : null;

  const environment =
    data.environment && inRange(data.environment.time, 0, 1) && WEATHER_TYPES.includes(data.environment.weather)
      ? { time: data.environment.time, weather: data.environment.weather }
      : null;

  const now = Date.now();
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, MAX_NAME_LENGTH) : "Untitled world";

  return {
    save: {
      version: SAVE_VERSION,
      id: data.id,
      name,
      createdAt: isFiniteNumber(data.createdAt) ? data.createdAt : now,
      updatedAt: isFiniteNumber(data.updatedAt) ? data.updatedAt : now,
      params: {
        seed: params.seed,
        generator,
        biomeScale,
        terrain: {
          scale: params.terrain.scale,
          magnitude: params.terrain.magnitude,
          offset: params.terrain.offset,
        },
      },
      chunkSize: { width, height },
      player,
      environment,
      edits: encodeEdits(edits),
    },
    warnings,
  };
}

/** Lightweight summary stored next to each save for the world list */
export function describeSave(save) {
  return {
    id: save.id,
    name: save.name,
    seed: save.params.seed,
    generator: save.params.generator,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    editCount: save.edits.length / 4,
  };
}
