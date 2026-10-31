//! Player preferences, small enough for localStorage

const STORAGE_KEY = "minecraft-js:settings";

/**
 * Every setting with its validation rules. The settings panel is generated
 * from this list, so adding an entry here is enough to expose it.
 */
export const SETTINGS_SCHEMA = [
  { key: "reach", label: "Building range", type: "range", min: 3, max: 12, step: 1, unit: " blocks", default: 6 },
  {
    key: "autosaveSeconds",
    label: "Autosave",
    type: "select",
    options: [
      [0, "Off"],
      [30, "Every 30 s"],
      [60, "Every minute"],
      [300, "Every 5 minutes"],
    ],
    default: 60,
  },
  { key: "historyLimit", label: "Undo history", type: "range", min: 50, max: 2000, step: 50, unit: " steps", default: 500 },
  { key: "sensitivity", label: "Mouse sensitivity", type: "range", min: 0.2, max: 3, step: 0.1, unit: "×", default: 1 },
  { key: "fov", label: "Field of view", type: "range", min: 50, max: 100, step: 1, unit: "°", default: 70 },
  { key: "volume", label: "Sound volume", type: "range", min: 0, max: 1, step: 0.05, percent: true, default: 0.35 },
  {
    key: "graphics",
    label: "Graphics",
    type: "select",
    options: [
      ["auto", "Auto"],
      ["low", "Low (phones)"],
      ["medium", "Medium"],
      ["high", "High"],
    ],
    default: "auto",
  },
  { key: "adaptiveResolution", label: "Adaptive resolution", type: "toggle", default: true },
  { key: "ambientVolume", label: "Ambient sounds", type: "range", min: 0, max: 1, step: 0.05, percent: true, default: 0.5 },
  {
    key: "dayMinutes",
    label: "Day length",
    type: "select",
    options: [
      [10, "10 minutes"],
      [20, "20 minutes"],
      [40, "40 minutes"],
      [0, "Paused (time stands still)"],
    ],
    default: 20,
  },
  { key: "showStats", label: "Performance stats", type: "toggle", default: false },
  { key: "showHelp", label: "Controls panel", type: "toggle", default: true },
];

const SCHEMA_BY_KEY = new Map(SETTINGS_SCHEMA.map((field) => [field.key, field]));

/** @returns the value if valid for the field, otherwise undefined */
export function validateSetting(key, value) {
  const field = SCHEMA_BY_KEY.get(key);
  if (!field) return undefined;
  switch (field.type) {
    case "range":
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      return Math.min(field.max, Math.max(field.min, value));
    case "toggle":
      return typeof value === "boolean" ? value : undefined;
    case "select":
      return field.options.some(([option]) => option === value) ? value : undefined;
  }
}

export class Settings {
  #listeners = new Set();
  #storage;

  /** @param {Storage | null} storage localStorage, or null to keep settings in memory */
  constructor(storage = globalThis.localStorage ?? null) {
    this.#storage = storage;
    this.values = Object.fromEntries(SETTINGS_SCHEMA.map((field) => [field.key, field.default]));
    // Non-schema state that should survive reloads
    this.hotbar = null;
    this.lastWorldId = null;
    this.#load();
  }

  get(key) {
    return this.values[key];
  }

  /** @returns {boolean} whether the value was valid and stored */
  set(key, value) {
    const valid = validateSetting(key, value);
    if (valid === undefined) return false;
    this.values[key] = valid;
    this.save();
    this.#listeners.forEach((listener) => listener(key, valid));
    return true;
  }

  /** @param {(key: string, value: any) => void} listener @returns unsubscribe */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  save() {
    try {
      this.#storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ values: this.values, hotbar: this.hotbar, lastWorldId: this.lastWorldId })
      );
    } catch {
      // Storage full or blocked: settings still work for this session
    }
  }

  #load() {
    let stored;
    try {
      stored = JSON.parse(this.#storage?.getItem(STORAGE_KEY) ?? "null");
    } catch {
      return;
    }
    if (!stored || typeof stored !== "object") return;

    for (const [key, value] of Object.entries(stored.values ?? {})) {
      const valid = validateSetting(key, value);
      if (valid !== undefined) this.values[key] = valid;
    }
    if (Array.isArray(stored.hotbar)) this.hotbar = stored.hotbar;
    if (typeof stored.lastWorldId === "string") this.lastWorldId = stored.lastWorldId;
  }
}
