import * as THREE from "three";
import { blocks } from "../blocks";
import { BIOME, biomeName } from "../terrain/biomes";
import { chunkUniforms, waterMaterial } from "../worldChunk";
import { Ambience } from "./ambience";
import { NatureEffects, Precipitation } from "./particles";
import { Sky } from "./sky";
import { WeatherState, formatTime, skyColor, sunState } from "./weather";

// Biomes with fireflies at night
const FIREFLY_BIOMES = new Set([BIOME.plains, BIOME.flowerField, BIOME.forest, BIOME.birchForest, BIOME.cherryGrove, BIOME.tropical]);
const QUIET_BIOMES = new Set([BIOME.desert, BIOME.snowyForest]);

/**
 * Everything around the player that isn't blocks: time of day, sky and
 * lighting, weather, wind, particles and ambient sound.
 */
export class Environment {
  /** 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset */
  time = 0.3;
  /** Real minutes per in-game day; 0 freezes time */
  dayMinutes = 20;
  /** Distance (blocks) where fog fully hides the world: set from the render distance */
  viewDistance = 96;
  wind = new THREE.Vector2(0.3, 0.1);

  #elapsed = 0;
  #sampleTimer = 0;
  #biome = null;
  #waterLevel = 0;
  #waterfalls = [];
  #color = new THREE.Color();

  constructor({ scene, sun, ambient, world, player }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.weather = new WeatherState();
    this.sky = new Sky(scene, sun, ambient);
    this.precipitation = new Precipitation(scene);
    this.effects = new NatureEffects(scene);
    this.ambience = new Ambience();
    scene.fog = new THREE.Fog(0x80a0e0, 60, 100);
  }

  get sun() {
    return sunState(this.time);
  }

  /** The biome at the player (null in worlds without biomes) */
  get biome() {
    return this.#biome;
  }

  /** Summary for the HUD: "Cherry Blossom Grove · 14:05 · Rain" */
  describe() {
    const weather = this.weather.current[0].toUpperCase() + this.weather.current.slice(1);
    const parts = [formatTime(this.time), weather];
    if (this.#biome !== null) parts.unshift(biomeName(this.#biome));
    return parts.join(" · ");
  }

  /** Particle amounts (graphics preset) */
  setQuality({ particles }) {
    this.precipitation.scale = particles;
    this.effects.scale = particles;
  }

  getState() {
    return { time: this.time, weather: this.weather.current };
  }

  setState(state) {
    if (!state) return;
    this.time = state.time;
    this.weather.setWeather(state.weather, { immediate: true });
  }

  update(dt) {
    this.#elapsed += dt;
    if (this.dayMinutes > 0) this.time = (this.time + dt / (this.dayMinutes * 60)) % 1;
    const center = this.player.position;

    // Sample the slow-changing surroundings a few times a second
    this.#sampleTimer -= dt;
    if (this.#sampleTimer <= 0) {
      this.#sampleTimer = 0.5;
      this.#sampleSurroundings(center);
    }

    this.weather.update(dt, this.#biome);
    const weather = this.weather.params;
    const sun = this.sun;

    // Wind: slowly turning direction, gusts, stronger in bad weather
    const strength = 0.25 + weather.wind * 1.1 + Math.sin(this.#elapsed * 0.37) * 0.15 * (0.5 + weather.wind);
    const angle = this.#elapsed * 0.01 + Math.sin(this.#elapsed * 0.05) * 0.6;
    this.wind.set(Math.cos(angle) * strength, Math.sin(angle) * strength);
    chunkUniforms.uTime.value = this.#elapsed;
    chunkUniforms.uWind.value.copy(this.wind).multiplyScalar(0.6);

    // Sky colour drives the background and fog
    const color = skyColor(sun, weather);
    this.#color.setRGB(color[0] / 255, color[1] / 255, color[2] / 255, THREE.SRGBColorSpace);
    this.scene.background = this.#color;
    this.scene.fog.color.copy(this.#color);
    this.scene.fog.far = this.viewDistance * (1 - weather.fog * 0.7);
    this.scene.fog.near = this.scene.fog.far * (0.55 - weather.fog * 0.45);

    const cloudHeight = this.world.chunkSize.height + 28;
    this.sky.update(dt, sun, weather, center, this.wind, cloudHeight, color);

    // Flowing water: the shared water texture scrolls
    waterMaterial.map.offset.y -= dt * 0.35;
    waterMaterial.map.offset.x += this.wind.x * dt * 0.02;

    const lightning = this.precipitation.update(dt, weather, center, this.wind, this.#elapsed);
    if (lightning) {
      this.sky.flash();
      this.ambience.thunder();
    }

    this.effects.update(dt, {
      center,
      wind: this.wind,
      time: this.#elapsed,
      night: 1 - sun.daylight,
      petalsActive: this.#biome === BIOME.cherryGrove && weather.rain < 0.5,
      firefliesActive: FIREFLY_BIOMES.has(this.#biome) && weather.rain < 0.3,
      waterfalls: this.#waterfalls,
      groundAt: (x, z) => this.world.getSurfaceHeight(x, z),
    });

    this.ambience.update(dt, {
      wind: weather.wind,
      rain: weather.rain,
      water: this.#waterLevel,
      day: sun.daylight,
      night: 1 - sun.daylight,
      wildlife: !QUIET_BIOMES.has(this.#biome) && weather.rain < 0.5,
    });
  }

  dispose() {
    this.ambience.dispose();
  }

  #sampleSurroundings(center) {
    const generator = this.world.generator;
    this.#biome = generator.type === "natural" ? generator.sampleColumn(center.x, center.z).biome : null;
    this.#waterfalls = this.world.getWaterfallsNear(center.x, center.z, 48);

    // How much water is close by (for the water sound), including waterfalls
    let water = 0;
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);
    for (let dx = -10; dx <= 10; dx += 2)
      for (let dz = -10; dz <= 10; dz += 2)
        for (let dy = -6; dy <= 2; dy += 2) if (this.world.getBlockId(cx + dx, cy + dy, cz + dz) === blocks.water.id) water++;
    let fallLoudness = 0;
    for (const fall of this.#waterfalls) {
      const distance = Math.hypot(fall.x - center.x, fall.y - center.y, fall.z - center.z);
      fallLoudness = Math.max(fallLoudness, Math.min(1, fall.height / 6) * Math.max(0, 1 - distance / 40));
    }
    this.#waterLevel = Math.min(1, water / 60 + fallLoudness);
  }
}
