import * as THREE from "three";
import { hash2 } from "../terrain/hash";

const STAR_COUNT = 900;
const SKY_RADIUS = 170; // inside the camera's far plane
const CLOUD_SIZE = 640;
const SHADOW_RANGE = 48;

function discTexture(inner, outer, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, inner);
  gradient.addColorStop(0.55, outer);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Blocky cloud map: each texel's alpha is a smooth value, so raising the
// alphaTest threshold shrinks clouds and lowering it grows them
function cloudTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const value = (x, z) => {
    // Sum of wrapped value noise at two scales (tiles seamlessly)
    const sample = (scale, salt) => {
      const gx = Math.floor(x / scale);
      const gz = Math.floor(z / scale);
      const fx = x / scale - gx;
      const fz = z / scale - gz;
      const n = size / scale;
      const at = (a, b) => hash2(salt, ((a % n) + n) % n, ((b % n) + n) % n);
      const top = at(gx, gz) * (1 - fx) + at(gx + 1, gz) * fx;
      const bottom = at(gx, gz + 1) * (1 - fx) + at(gx + 1, gz + 1) * fx;
      return top * (1 - fz) + bottom * fz;
    };
    return sample(8, 1) * 0.65 + sample(4, 2) * 0.35;
  };
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const i = (z * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(value(x, z) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

/**
 * Sky dome contents and lighting: the existing sun light follows the player
 * (so shadows work anywhere in the endless world) and becomes moonlight at
 * night; a hemisphere light fills shadows; stars, sun and moon discs and a
 * drifting cloud layer sit around the camera.
 */
export class Sky {
  #windOffset = new THREE.Vector2();
  #flash = 0;
  /** Lightning strikes so far */
  flashes = 0;

  constructor(scene, sun, ambient) {
    this.scene = scene;
    this.sun = sun;
    this.ambient = ambient;
    scene.add(sun.target);

    this.hemisphere = new THREE.HemisphereLight(0xbcd4ff, 0x4a3b2a, 0.3);
    scene.add(this.hemisphere);

    const shadowCamera = sun.shadow.camera;
    shadowCamera.left = shadowCamera.bottom = -SHADOW_RANGE;
    shadowCamera.right = shadowCamera.top = SHADOW_RANGE;
    shadowCamera.near = 1;
    shadowCamera.far = 260;
    shadowCamera.updateProjectionMatrix();

    const starPositions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = hash2(91, i, 0);
      const v = hash2(92, i, 0);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v * 1.6); // mostly above the horizon
      starPositions.set([Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)].map((c) => c * SKY_RADIUS), i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })
    );
    this.stars.frustumCulled = false;

    const discMaterial = (texture) => new THREE.SpriteMaterial({ map: texture, fog: false, depthWrite: false, transparent: true });
    this.sunDisc = new THREE.Sprite(discMaterial(discTexture("rgba(255,250,220,1)", "rgba(255,210,120,0.45)")));
    this.sunDisc.scale.setScalar(34);
    this.moonDisc = new THREE.Sprite(discMaterial(discTexture("rgba(232,236,250,1)", "rgba(180,190,230,0.25)")));
    this.moonDisc.scale.setScalar(20);

    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(CLOUD_SIZE, CLOUD_SIZE).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, opacity: 0.9, alphaTest: 0.7, side: THREE.DoubleSide, depthWrite: false })
    );
    this.clouds.renderOrder = -1;

    for (const object of [this.stars, this.sunDisc, this.moonDisc, this.clouds]) {
      object.frustumCulled = false;
      scene.add(object);
    }
  }

  /** Brief bright flash (lightning) */
  flash() {
    this.#flash = 1;
    this.flashes++;
  }

  /**
   * @param {ReturnType<import("./weather").sunState>} sunState
   * @param {typeof import("./weather").WEATHER.clear} weather
   * @param {THREE.Vector3} center player / camera position
   * @param {{ x: number, y: number }} wind
   * @param {number} cloudHeight
   */
  update(dt, sunState, weather, center, wind, cloudHeight, skyColor) {
    const [dx, dy, dz] = sunState.direction;
    const isDay = sunState.elevation > -0.05;
    const lightDir = isDay ? [dx, dy, dz] : [-dx, -dy, -dz];
    this.#flash = Math.max(0, this.#flash - dt * 6);

    // Shadow camera follows the player, snapped to whole blocks to avoid shimmering
    const cx = Math.round(center.x);
    const cz = Math.round(center.z);
    this.sun.target.position.set(cx, center.y, cz);
    this.sun.position.set(cx + lightDir[0] * 120, center.y + lightDir[1] * 120, cz + lightDir[2] * 120);

    const dim = 1 - weather.darkness * 0.7;
    if (isDay) {
      // Warm and low at sunrise / sunset, white at noon
      const warmth = Math.min(1, Math.max(0, sunState.elevation / 0.35));
      this.sun.color.setRGB(1, 0.78 + 0.22 * warmth, 0.6 + 0.4 * warmth);
      this.sun.intensity = sunState.daylight * 1.1 * dim;
    } else {
      this.sun.color.setRGB(0.62, 0.7, 1);
      this.sun.intensity = 0.16 * (1 - sunState.daylight) * dim;
    }
    this.ambient.intensity = 0.06 + 0.1 * sunState.daylight + this.#flash * 0.8;
    this.hemisphere.intensity = (0.1 + 0.32 * sunState.daylight) * (1 - weather.darkness * 0.4) + this.#flash * 1.5;
    this.hemisphere.color.setRGB(skyColor[0] / 255, skyColor[1] / 255, skyColor[2] / 255).lerp(_white, 0.4);

    // Sky objects sit around the camera
    const night = 1 - sunState.daylight;
    this.stars.position.copy(center);
    this.stars.material.opacity = night * (1 - weather.cloud * 0.85);
    this.sunDisc.position.set(center.x + dx * 150, center.y + dy * 150, center.z + dz * 150);
    this.moonDisc.position.set(center.x - dx * 150, center.y - dy * 150, center.z - dz * 150);
    this.sunDisc.material.opacity = (1 - weather.cloud * 0.8) * (sunState.elevation > -0.1 ? 1 : 0);
    this.moonDisc.material.opacity = (1 - weather.cloud * 0.8) * (sunState.elevation < 0.1 ? 1 : 0);

    // Clouds: drift with the wind, stay put in the world as the player moves, thicken with weather
    this.#windOffset.x += wind.x * dt * 2;
    this.#windOffset.y += wind.y * dt * 2;
    this.clouds.position.set(center.x, cloudHeight, center.z);
    const map = this.clouds.material.map;
    map.offset.set((center.x + this.#windOffset.x) / CLOUD_SIZE, -(center.z + this.#windOffset.y) / CLOUD_SIZE);
    this.clouds.material.alphaTest = 0.85 - weather.cloud * 0.6;
    const brightness = (0.35 + 0.65 * sunState.daylight) * (1 - weather.darkness * 0.6);
    this.clouds.material.color.setRGB(brightness, brightness, brightness * 1.03);
  }
}

const _white = new THREE.Color(1, 1, 1);
