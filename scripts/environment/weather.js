import { BIOME, BIOMES } from "../terrain/biomes";

/**
 * What each weather type looks like. The environment blends between these,
 * so changes are gradual: cloud cover, rain / snow amount, fog, how much the
 * light dims, wind strength and whether lightning strikes.
 */
export const WEATHER = {
  clear: { cloud: 0.15, rain: 0, snow: 0, fog: 0, darkness: 0, wind: 0.2, lightning: 0 },
  cloudy: { cloud: 0.7, rain: 0, snow: 0, fog: 0.1, darkness: 0.15, wind: 0.35, lightning: 0 },
  rain: { cloud: 0.9, rain: 0.8, snow: 0, fog: 0.25, darkness: 0.35, wind: 0.5, lightning: 0 },
  thunderstorm: { cloud: 1, rain: 1, snow: 0, fog: 0.3, darkness: 0.55, wind: 0.9, lightning: 1 },
  snow: { cloud: 0.85, rain: 0, snow: 0.9, fog: 0.35, darkness: 0.25, wind: 0.4, lightning: 0 },
  fog: { cloud: 0.5, rain: 0, snow: 0, fog: 0.85, darkness: 0.2, wind: 0.1, lightning: 0 },
};
const KEYS = Object.keys(WEATHER.clear);
// Seconds for a transition to get ~63% of the way to the new weather
const TRANSITION_SECONDS = 8;

/** Biomes where precipitation falls as snow */
export function isColdBiome(biome) {
  return biome === BIOME.snowyForest || biome === BIOME.mountains;
}

/**
 * Weather state machine. Every few minutes it picks new weather, weighted
 * by the biome the player is in (deserts stay dry, tropics get storms, cold
 * biomes snow). Parameters blend smoothly towards the chosen weather.
 */
export class WeatherState {
  current = "clear";
  /** Blended parameters actually shown */
  params = { ...WEATHER.clear };

  /** @param {{ random?: () => number, minSeconds?: number, maxSeconds?: number }} options */
  constructor({ random = Math.random, minSeconds = 120, maxSeconds = 300 } = {}) {
    this.random = random;
    this.minSeconds = minSeconds;
    this.maxSeconds = maxSeconds;
    this.timer = this.#nextDuration();
  }

  /** @param {number | null} biome biome at the player (null: no biomes, e.g. classic worlds) */
  update(dt, biome = null) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.setWeather(this.pickNext(biome));
      this.timer = this.#nextDuration();
    }
    // Rain turns to snow (and back) when the player walks between climates
    const cold = isColdBiome(biome);
    if (cold && (this.current === "rain" || this.current === "thunderstorm")) this.current = "snow";
    if (!cold && biome !== null && this.current === "snow") this.current = "rain";

    const target = WEATHER[this.current];
    const k = 1 - Math.exp(-dt / TRANSITION_SECONDS);
    for (const key of KEYS) this.params[key] += (target[key] - this.params[key]) * k;
  }

  /** Weighted random pick from the biome's weather table */
  pickNext(biome) {
    const table = BIOMES[biome]?.weather ?? BIOMES[BIOME.plains].weather;
    const entries = Object.entries(table);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.random() * total;
    for (const [type, weight] of entries) {
      roll -= weight;
      if (roll < 0) return type;
    }
    return entries[0][0];
  }

  /** @param {{ immediate?: boolean }} options immediate skips the transition (used when loading) */
  setWeather(type, { immediate = false } = {}) {
    if (!WEATHER[type]) return;
    this.current = type;
    if (immediate) Object.assign(this.params, WEATHER[type]);
  }

  #nextDuration() {
    return this.minSeconds + this.random() * (this.maxSeconds - this.minSeconds);
  }
}

//! Day / night

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sun for a time of day (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset).
 * @returns {{ direction: number[], elevation: number, daylight: number, twilight: number }}
 */
export function sunState(time) {
  const angle = (time - 0.25) * Math.PI * 2;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  const z = 0.35;
  const length = Math.hypot(x, y, z);
  const elevation = y / length;
  return {
    direction: [x / length, elevation, z / length],
    elevation,
    // 0 at night, 1 in full day
    daylight: smoothstep(-0.12, 0.2, elevation),
    // Peaks around sunrise / sunset
    twilight: Math.max(0, 1 - Math.abs(elevation) / 0.25) * (elevation > -0.2 ? 1 : 0),
  };
}

const NIGHT = [10, 16, 36];
const DAY = [128, 160, 224];
const SUNSET = [240, 160, 112];
const STORM = [120, 126, 136];

/** Sky / fog colour [r, g, b] (0-255) for the sun state and weather */
export function skyColor(sun, weather) {
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  let color = mix(NIGHT, DAY, sun.daylight);
  color = mix(color, SUNSET, sun.twilight * 0.55 * (1 - weather.cloud * 0.6));
  color = mix(color, STORM.map((v) => v * (0.25 + 0.75 * sun.daylight)), weather.cloud * 0.55);
  return color.map((v) => v * (1 - weather.darkness * 0.45));
}

/** "HH:MM" for a time of day */
export function formatTime(time) {
  const minutes = Math.floor(time * 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
