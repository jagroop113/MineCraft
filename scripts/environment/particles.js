import * as THREE from "three";

//! Weather and nature particles. Each effect is one draw call over a fixed,
//! pre-allocated buffer (object pooling): particles are recycled, never created.

const BOX = 22; // half-size of the volume around the camera that rain / snow fill

// Writes without allocating (these loops run for hundreds of particles every frame)
function writeVector(array, index, x, y, z) {
  array[index * 3] = x;
  array[index * 3 + 1] = y;
  array[index * 3 + 2] = z;
}

function softDot() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.8)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}
const dotTexture = typeof document !== "undefined" ? softDot() : null;

function pointsObject(count, { size, color, opacity = 1, additive = false, vertexColors = false, map = dotTexture, attenuate = true }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  if (vertexColors) geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setDrawRange(0, 0);
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size,
      color,
      map,
      vertexColors,
      transparent: true,
      opacity,
      depthWrite: false,
      sizeAttenuation: attenuate,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
  );
  points.frustumCulled = false;
  return points;
}

/** Rain streaks, snowflakes and lightning timing */
export class Precipitation {
  #lightningTimer = 8;

  constructor(scene, maxDrops = 1600) {
    this.maxDrops = maxDrops;
    this.scale = 1;
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxDrops * 6), 3));
    rainGeometry.setDrawRange(0, 0);
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xa9bedf, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.snow = pointsObject(maxDrops, { size: 0.16, color: 0xffffff, opacity: 0.9 });
    this.drops = new Float32Array(maxDrops * 3); // x, y, z offsets relative to the camera box
    for (let i = 0; i < maxDrops; i++) this.#respawn(i, true);
    scene.add(this.rain, this.snow);
  }

  #respawn(i, anywhere = false) {
    this.drops[i * 3] = (Math.random() * 2 - 1) * BOX;
    this.drops[i * 3 + 1] = anywhere ? (Math.random() * 2 - 1) * BOX : BOX;
    this.drops[i * 3 + 2] = (Math.random() * 2 - 1) * BOX;
  }

  /**
   * @param {{ rain: number, snow: number, lightning: number }} weather
   * @returns {boolean} true when lightning strikes this frame
   */
  update(dt, weather, center, wind, time) {
    const rainCount = Math.floor(this.maxDrops * this.scale * weather.rain);
    const snowCount = Math.floor(this.maxDrops * this.scale * 0.6 * weather.snow);
    const count = Math.max(rainCount, snowCount);
    const falling = rainCount >= snowCount;
    const speed = falling ? 26 : 2.2;
    const rainPositions = this.rain.geometry.attributes.position.array;
    const snowPositions = this.snow.geometry.attributes.position.array;

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      this.drops[o + 1] -= speed * dt;
      this.drops[o] += wind.x * dt * (falling ? 4 : 2) + (falling ? 0 : Math.sin(time * 1.3 + i) * dt * 0.6);
      this.drops[o + 2] += wind.y * dt * (falling ? 4 : 2);
      if (this.drops[o + 1] < -BOX || Math.abs(this.drops[o]) > BOX || Math.abs(this.drops[o + 2]) > BOX) this.#respawn(i);
      const x = center.x + this.drops[o];
      const y = center.y + this.drops[o + 1];
      const z = center.z + this.drops[o + 2];
      if (falling) {
        const r = i * 6;
        rainPositions[r] = x;
        rainPositions[r + 1] = y;
        rainPositions[r + 2] = z;
        rainPositions[r + 3] = x - wind.x * 0.08;
        rainPositions[r + 4] = y + 0.7;
        rainPositions[r + 5] = z - wind.y * 0.08;
      } else {
        snowPositions[o] = x;
        snowPositions[o + 1] = y;
        snowPositions[o + 2] = z;
      }
    }
    this.rain.geometry.setDrawRange(0, falling ? count * 2 : 0);
    this.snow.geometry.setDrawRange(0, falling ? 0 : count);
    this.rain.geometry.attributes.position.needsUpdate = falling && count > 0;
    this.snow.geometry.attributes.position.needsUpdate = !falling && count > 0;
    this.rain.material.opacity = 0.25 + 0.35 * weather.rain;

    if (weather.lightning > 0.5) {
      this.#lightningTimer -= dt;
      if (this.#lightningTimer <= 0) {
        this.#lightningTimer = 5 + Math.random() * 12;
        return true;
      }
    }
    return false;
  }
}

/** Falling cherry petals, night fireflies and waterfall spray / mist */
export class NatureEffects {
  constructor(scene, { petals = 180, fireflies = 70, spray = 360 } = {}) {
    this.capacity = { petals, fireflies, spray };
    this.scale = 1;
    this.petals = pointsObject(petals, { size: 0.16, color: 0xf6b3d2, map: null });
    this.fireflies = pointsObject(fireflies, { size: 0.22, color: 0xffffff, additive: true, vertexColors: true });
    this.spray = pointsObject(spray, { size: 0.28, color: 0xeaf6ff, opacity: 0.75 });
    this.mist = pointsObject(spray / 3, { size: 1.6, color: 0xffffff, opacity: 0.22 });

    this.petalState = new Float32Array(petals * 4); // x, y, z, phase (world coordinates)
    this.fireflyState = new Float32Array(fireflies * 5); // x, y, z, phase, ground
    this.sprayState = new Float32Array(spray * 7); // x, y, z, vx, vy, vz, life
    this.mistState = new Float32Array((spray / 3) * 5); // x, y, z, life, rise
    this.petalCount = 0;
    this.fireflyCount = 0;
    scene.add(this.petals, this.fireflies, this.spray, this.mist);
  }

  /**
   * @param {{ center: THREE.Vector3, wind: {x, y}, time: number, night: number, petalsActive: boolean,
   *           firefliesActive: boolean, waterfalls: {x, y, z, height}[], groundAt: (x, z) => number }} state
   */
  update(dt, state) {
    this.#updatePetals(dt, state);
    this.#updateFireflies(dt, state);
    this.#updateSpray(dt, state);
  }

  #updatePetals(dt, { center, wind, time, petalsActive }) {
    // Fade the count in and out instead of popping
    const target = petalsActive ? Math.floor(this.capacity.petals * this.scale) : 0;
    this.petalCount += Math.sign(target - this.petalCount) * Math.min(Math.abs(target - this.petalCount), Math.ceil(dt * 60));
    const state = this.petalState;
    const positions = this.petals.geometry.attributes.position.array;
    for (let i = 0; i < this.petalCount; i++) {
      const o = i * 4;
      const outside = Math.abs(state[o] - center.x) > 20 || Math.abs(state[o + 2] - center.z) > 20;
      if (state[o + 1] < center.y - 6 || outside || state[o + 3] === 0) {
        state[o] = center.x + (Math.random() * 2 - 1) * 20;
        state[o + 1] = center.y + 2 + Math.random() * 12;
        state[o + 2] = center.z + (Math.random() * 2 - 1) * 20;
        state[o + 3] = 1 + Math.random() * 6;
      }
      const phase = state[o + 3];
      state[o] += (wind.x * 1.5 + Math.sin(time * 1.7 + phase) * 0.5) * dt;
      state[o + 1] -= (0.6 + 0.25 * Math.sin(time * 2.3 + phase)) * dt;
      state[o + 2] += (wind.y * 1.5 + Math.cos(time * 1.3 + phase) * 0.5) * dt;
      writeVector(positions, i, state[o], state[o + 1], state[o + 2]);
    }
    this.petals.geometry.setDrawRange(0, this.petalCount);
    this.petals.geometry.attributes.position.needsUpdate = this.petalCount > 0;
  }

  #updateFireflies(dt, { center, time, night, firefliesActive, groundAt }) {
    const target = firefliesActive && night > 0.6 ? Math.floor(this.capacity.fireflies * this.scale) : 0;
    this.fireflyCount += Math.sign(target - this.fireflyCount) * Math.min(Math.abs(target - this.fireflyCount), Math.ceil(dt * 30));
    const state = this.fireflyState;
    const positions = this.fireflies.geometry.attributes.position.array;
    const colors = this.fireflies.geometry.attributes.color.array;
    for (let i = 0; i < this.fireflyCount; i++) {
      const o = i * 5;
      if (state[o + 3] === 0 || Math.abs(state[o] - center.x) > 24 || Math.abs(state[o + 2] - center.z) > 24) {
        state[o] = center.x + (Math.random() * 2 - 1) * 22;
        state[o + 2] = center.z + (Math.random() * 2 - 1) * 22;
        state[o + 4] = groundAt(state[o], state[o + 2]);
        state[o + 3] = 1 + Math.random() * 100;
      }
      const phase = state[o + 3];
      state[o] += Math.sin(time * 0.7 + phase) * dt * 0.8;
      state[o + 2] += Math.cos(time * 0.6 + phase * 1.3) * dt * 0.8;
      state[o + 1] = state[o + 4] + 0.8 + Math.sin(time * 0.9 + phase) * 0.7 + 0.8;
      writeVector(positions, i, state[o], state[o + 1], state[o + 2]);
      // Each firefly blinks on its own rhythm
      const glow = Math.max(0, Math.sin(time * 2.2 + phase * 3)) ** 3;
      writeVector(colors, i, 0.85 * glow, glow, 0.35 * glow);
    }
    this.fireflies.geometry.setDrawRange(0, this.fireflyCount);
    this.fireflies.geometry.attributes.position.needsUpdate = this.fireflyCount > 0;
    this.fireflies.geometry.attributes.color.needsUpdate = this.fireflyCount > 0;
  }

  #updateSpray(dt, { waterfalls }) {
    const spray = this.sprayState;
    const capacity = Math.floor(this.capacity.spray * this.scale);
    const positions = this.spray.geometry.attributes.position.array;
    const mist = this.mistState;
    const mistCapacity = Math.floor(capacity / 3);
    const mistPositions = this.mist.geometry.attributes.position.array;

    // Emit from the base of each nearby waterfall, more for taller falls
    let emit = waterfalls.length ? dt * 90 * this.scale : 0;
    let mistEmit = waterfalls.length ? dt * 14 * this.scale : 0;
    let sprayCount = 0;
    for (let i = 0; i < capacity; i++) {
      const o = i * 7;
      if (spray[o + 6] <= 0 && emit >= 1) {
        const fall = waterfalls[Math.floor(Math.random() * waterfalls.length)];
        const power = Math.min(1, fall.height / 8);
        spray.set([fall.x + Math.random() - 0.5, fall.y + 0.6, fall.z + Math.random() - 0.5,
          (Math.random() - 0.5) * 3, 1.5 + Math.random() * 3 * power, (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.7], o);
        emit--;
      }
      if (spray[o + 6] > 0) {
        spray[o + 6] -= dt;
        spray[o + 4] -= 9 * dt;
        spray[o] += spray[o + 3] * dt;
        spray[o + 1] += spray[o + 4] * dt;
        spray[o + 2] += spray[o + 5] * dt;
        writeVector(positions, sprayCount, spray[o], spray[o + 1], spray[o + 2]);
        sprayCount++;
      }
    }
    let mistCount = 0;
    for (let i = 0; i < mistCapacity; i++) {
      const o = i * 5;
      if (mist[o + 3] <= 0 && mistEmit >= 1) {
        const fall = waterfalls[Math.floor(Math.random() * waterfalls.length)];
        mist.set([fall.x + (Math.random() - 0.5) * 2, fall.y + 0.5, fall.z + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, 0.3 + Math.random() * 0.5], o);
        mistEmit--;
      }
      if (mist[o + 3] > 0) {
        mist[o + 3] -= dt;
        mist[o + 1] += mist[o + 4] * dt;
        writeVector(mistPositions, mistCount, mist[o], mist[o + 1], mist[o + 2]);
        mistCount++;
      }
    }
    this.spray.geometry.setDrawRange(0, sprayCount);
    this.mist.geometry.setDrawRange(0, mistCount);
    this.spray.geometry.attributes.position.needsUpdate = sprayCount > 0;
    this.mist.geometry.attributes.position.needsUpdate = mistCount > 0;
  }

  get activeSprayCount() {
    return this.spray.geometry.drawRange.count;
  }
}
