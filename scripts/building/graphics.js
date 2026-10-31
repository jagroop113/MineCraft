import * as THREE from "three";
import { chunkRenderSettings, waterMaterial } from "../worldChunk";

/**
 * Graphics presets. Distances are in blocks so they work for any chunk size.
 * - renderDistance: how far chunks load (fog hides the edge)
 * - plantDistance: grass / flowers are drawn this far (level of detail)
 * - grassDensity: share of grass and ferns drawn
 * - softShadows: smoother (but per-pixel costlier) shadow edges
 * - shadowEvery: redraw the shadow map every N frames (the sun moves slowly)
 * - animals: wildlife population; particles: share of rain / petals / spray
 * - pixelRatioMax / resolutionScale: render resolution
 * - waterSpecular: sun highlights on water
 */
export const GRAPHICS_PRESETS = {
  low: { renderDistance: 64, plantDistance: 32, grassDensity: 0.35, shadows: false, shadowMapSize: 512, animals: 10, particles: 0.35, pixelRatioMax: 1, resolutionScale: 0.85, waterSpecular: false },
  medium: { renderDistance: 96, plantDistance: 40, grassDensity: 0.5, shadows: true, softShadows: false, shadowEvery: 3, shadowMapSize: 1024, animals: 22, particles: 0.7, pixelRatioMax: 1.5, resolutionScale: 1, waterSpecular: false },
  high: { renderDistance: 128, plantDistance: 80, grassDensity: 1, shadows: true, softShadows: true, shadowEvery: 2, shadowMapSize: 2048, animals: 36, particles: 1, pixelRatioMax: 2, resolutionScale: 1, waterSpecular: true },
};

export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const fine = window.matchMedia?.("(pointer: fine)").matches ?? false;
  return coarse && !fine;
}

// Integrated / mobile / software GPUs (from WEBGL_debug_renderer_info)
const MODEST_GPU = /intel|mali|adreno|powervr|swiftshader|llvmpipe|software|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/i;

/** Name of the GPU, when the browser exposes it */
export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "";
  } catch {
    return "";
  }
}

/**
 * Preset for "Auto": phones and tablets get Low, integrated GPUs and small
 * CPUs Medium, dedicated GPUs High. Adaptive resolution fine-tunes from there.
 */
export function autoPreset(renderer) {
  if (isTouchDevice()) return "low";
  const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
  if (cores <= 4 || (renderer && MODEST_GPU.test(gpuName(renderer)))) return "medium";
  return "high";
}

// Adaptive resolution: drop render resolution when frames are slow, raise it back when fast
const MIN_DYNAMIC_SCALE = 0.6;
const SLOW_FPS = 40;
const FAST_FPS = 57;

/** Applies a preset to the renderer, world, lights, environment and wildlife */
export class GraphicsController {
  adaptive = true;
  dynamicScale = 1;
  /** Name of the preset in use ("low" | "medium" | "high") */
  current = "high";

  #slow = 0;
  #fast = 0;
  #shadowFrames = 0;

  constructor({ renderer, world, sun, camera, environment, wildlife }) {
    Object.assign(this, { renderer, world, sun, camera, environment, wildlife });
    // Shadow maps are redrawn on a schedule (see update) instead of every frame
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
  }

  /** Call once per frame */
  update() {
    if (!this.sun.castShadow) return;
    if (++this.#shadowFrames >= (this.preset.shadowEvery ?? 1)) this.requestShadowUpdate();
  }

  /** Redraw shadows on the next frame (e.g. a block changed near the player) */
  requestShadowUpdate() {
    this.#shadowFrames = 0;
    this.renderer.shadowMap.needsUpdate = true;
  }

  get preset() {
    return GRAPHICS_PRESETS[this.current];
  }

  /** @param {"auto" | "low" | "medium" | "high"} name */
  apply(name) {
    this.current = name === "auto" ? autoPreset(this.renderer) : name;
    const preset = this.preset;

    this.applyToWorld();
    if (chunkRenderSettings.grassDensity !== preset.grassDensity) {
      chunkRenderSettings.grassDensity = preset.grassDensity;
      for (const chunk of this.world.children) chunk.rebuildPlants?.();
    }

    this.sun.castShadow = preset.shadows;
    const shadowType = preset.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== shadowType) {
      this.renderer.shadowMap.type = shadowType;
      // Shaders are compiled for one shadow filter: rebuild them
      this.sun.parent?.traverse((object) => [object.material].flat().forEach((m) => m && (m.needsUpdate = true)));
      waterMaterial.needsUpdate = true;
    }
    if (this.sun.shadow.mapSize.x !== preset.shadowMapSize) {
      this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    waterMaterial.specular.set(preset.waterSpecular ? 0x556677 : 0x000000);

    this.environment.setQuality({ particles: preset.particles });
    this.environment.viewDistance = preset.renderDistance - 8;
    this.wildlife.cap = preset.animals;
    this.wildlife.spawnRadius = Math.min(56, preset.renderDistance - 12);
    this.wildlife.despawnRadius = Math.max(40, preset.renderDistance - 4);
    this.wildlife.setShadows(preset.shadows);

    // The sky (stars, sun, moon) sits ~170 blocks out, so the far plane covers at least that
    this.camera.far = Math.max(200, preset.renderDistance + 60);
    this.camera.updateProjectionMatrix();
    this.#applyResolution();
  }

  /** Chunk-based settings depend on the world's chunk size: call after a world loads */
  applyToWorld() {
    const preset = this.preset;
    const width = this.world.chunkSize.width;
    this.world.drawDistance = Math.max(1, Math.round(preset.renderDistance / width));
    this.world.plantDistance = preset.plantDistance / width;
  }

  setAdaptive(enabled) {
    this.adaptive = enabled;
    if (!enabled) {
      this.dynamicScale = 1;
      this.#applyResolution();
    }
  }

  /** Feed with measured frame rates (a few times a second) */
  sample(fps) {
    if (!this.adaptive || fps <= 0) return;
    if (fps < SLOW_FPS) {
      this.#slow++;
      this.#fast = 0;
    } else if (fps >= FAST_FPS) {
      this.#fast++;
      this.#slow = 0;
    } else {
      this.#slow = this.#fast = 0;
    }
    if (this.#slow >= 3 && this.dynamicScale > MIN_DYNAMIC_SCALE) {
      this.dynamicScale = Math.max(MIN_DYNAMIC_SCALE, this.dynamicScale - 0.1);
      this.#slow = 0;
      this.#applyResolution();
    } else if (this.#fast >= 8 && this.dynamicScale < 1) {
      this.dynamicScale = Math.min(1, this.dynamicScale + 0.1);
      this.#fast = 0;
      this.#applyResolution();
    }
  }

  get pixelRatio() {
    const preset = this.preset;
    return Math.min(window.devicePixelRatio || 1, preset.pixelRatioMax) * preset.resolutionScale * this.dynamicScale;
  }

  #applyResolution() {
    this.renderer.setPixelRatio(this.pixelRatio);
  }
}
