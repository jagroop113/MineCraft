import * as THREE from "three";
import { BLOCK_LAYER, LAYER, SOLID, blocks } from "../blocks";
import { BIOME, BIOMES, WATER_ANIMALS } from "../terrain/biomes";
import { SPECIES, buildModel } from "./species";

const WATER = blocks.water.id;
// Animals spawn on natural ground only (not on roofs, leaves or player builds)
const NATURAL_GROUND = new Set([blocks.grass.id, blocks.dirt.id, blocks.sand.id, blocks.snowyGrass.id, blocks.snow.id, blocks.stone.id, blocks.gravel.id]);
const LEAVES = new Set([blocks.leaves.id, blocks.birchLeaves.id, blocks.cherryLeaves.id, blocks.pineLeaves.id, blocks.jungleLeaves.id]);
const MAX_PER_SPECIES = 24;
// Within this distance animals think every frame; further away a few times a second
const FULL_RATE_RADIUS = 40;

const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _scale = new THREE.Vector3();
const _position = new THREE.Vector3();

const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Living animals around the player. Each animal runs a small state machine
 * (idle, wander, graze, drink, flee, sleep, follow its group's leader) and
 * walks on the voxel terrain. Animals are pooled and every species renders
 * as one InstancedMesh.
 */
export class Wildlife {
  /** Total animals alive at once (graphics preset) */
  cap = 30;
  spawnRadius = 56;
  despawnRadius = 80;
  /** @type {Animal[]} */
  animals = [];

  #pool = [];
  #spawnTimer = 0;
  #meshes = {};
  #nextGroup = 1;

  /**
   * @param {{ scene?: THREE.Scene, world: import("../world").World, random?: () => number }} options
   */
  constructor({ scene = null, world, random = Math.random }) {
    this.world = world;
    this.random = random;
    if (scene) {
      for (const [name, def] of Object.entries(SPECIES)) {
        const mesh = new THREE.InstancedMesh(buildModel(def.parts), material, MAX_PER_SPECIES);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = def.habitat === "land";
        mesh.name = name;
        this.#meshes[name] = mesh;
        scene.add(mesh);
      }
    }
  }

  setShadows(enabled) {
    for (const [name, mesh] of Object.entries(this.#meshes)) mesh.castShadow = enabled && SPECIES[name].habitat === "land";
  }

  /** @returns {Record<string, number>} live animals per species */
  counts() {
    const counts = {};
    for (const animal of this.animals) counts[animal.species] = (counts[animal.species] ?? 0) + 1;
    return counts;
  }

  /**
   * @param {{ player: { position: THREE.Vector3 }, night: number }} context
   *   night: 0 in full day, 1 at night
   */
  update(dt, context) {
    const { position } = context.player;
    this.#spawnTimer -= dt;
    if (this.#spawnTimer <= 0) {
      this.#spawnTimer = 0.6;
      if (this.animals.length < this.cap) this.trySpawnGroup(position, context.night);
    }

    for (let i = this.animals.length - 1; i >= 0; i--) {
      const animal = this.animals[i];
      const distance = Math.hypot(animal.position.x - position.x, animal.position.z - position.z);
      if (distance > this.despawnRadius || !this.world.isLoadedAt(animal.position.x, animal.position.z)) {
        this.#release(i);
        continue;
      }
      // Distant animals are simulated less often (their accumulated time is used)
      animal.pending += dt;
      if (distance > FULL_RATE_RADIUS && animal.pending < 0.25) continue;
      this.#think(animal, animal.pending, context, distance);
      animal.pending = 0;
    }
    this.#render();
  }

  //! Spawning

  /** Tries to spawn one group somewhere around `center` */
  trySpawnGroup(center, night = 0) {
    const angle = this.random() * Math.PI * 2;
    const distance = 20 + this.random() * Math.max(1, this.spawnRadius - 20);
    const x = Math.round(center.x + Math.cos(angle) * distance);
    const z = Math.round(center.z + Math.sin(angle) * distance);
    const column = this.#column(x, z);
    if (!column) return null;

    const generator = this.world.generator;
    const biome = generator.type === "natural" ? generator.sampleColumn(x, z).biome : BIOME.plains;
    let table;
    if (column.top === WATER) {
      if (biome === BIOME.snowyForest) return null;
      table = WATER_ANIMALS;
    } else if (NATURAL_GROUND.has(column.top)) {
      table = BIOMES[biome].animals;
    } else {
      return null;
    }
    // Insects only fly by day
    const options = table.filter(({ species }) => !(night > 0.5 && SPECIES[species].habitat === "flutter"));
    const species = this.#pickWeighted(options);
    if (!species) return null;
    return this.spawnGroup(species, x, z, column);
  }

  /** Spawns a group of `species` around (x, z); returns the animals created */
  spawnGroup(species, x, z, column = this.#column(x, z)) {
    const def = SPECIES[species];
    if (!column) return [];
    // Frogs and turtles picked at a lake or river start on the nearest bank
    if (def.habitat === "shore" && column.top === WATER) {
      const bank = this.#findBank(x, z, 5);
      if (!bank) return [];
      ({ x, z, column } = bank);
    }
    const counts = this.counts();
    const room = Math.min(this.cap - this.animals.length, MAX_PER_SPECIES - (counts[species] ?? 0));
    const [min, max] = def.group;
    const size = Math.min(room, min + Math.floor(this.random() * (max - min + 1)));
    const group = this.#nextGroup++;
    const created = [];
    for (let i = 0; i < size; i++) {
      const ox = i === 0 ? 0 : Math.round((this.random() - 0.5) * 5);
      const oz = i === 0 ? 0 : Math.round((this.random() - 0.5) * 5);
      const position = this.#spawnPosition(def, x + ox, z + oz, i === 0 ? column : null);
      if (!position) continue;
      const animal = this.#acquire(species, def, position, group);
      animal.leader = created[0] ?? null;
      animal.offset.set((this.random() - 0.5) * 4, 0, (this.random() - 0.5) * 4);
      created.push(animal);
    }
    return created;
  }

  #spawnPosition(def, x, z, column) {
    column ??= this.#column(x, z);
    if (!column) return null;
    switch (def.habitat) {
      case "water": {
        if (column.top !== WATER) return null;
        let bed = column.y;
        while (this.world.getBlockId(x, bed - 1, z) === WATER) bed--;
        if (column.y - bed < 1) return null; // too shallow
        return new THREE.Vector3(x, bed + this.random() * (column.y - bed), z);
      }
      case "air":
        if (column.top === WATER) return null;
        return new THREE.Vector3(x, column.y + 8 + this.random() * 10, z);
      case "flutter":
        return NATURAL_GROUND.has(column.top) ? new THREE.Vector3(x, column.y + 1 + this.random() * 1.5, z) : null;
      case "shore":
        // On land with water close by
        if (column.top === WATER || !this.#findWater(x, column.y + 1, z, 5)) return null;
        return new THREE.Vector3(x, column.y + 0.5, z);
      default: {
        if (!NATURAL_GROUND.has(column.top)) return null;
        // Room to stand
        if (SOLID[this.world.getBlockId(x, column.y + 1, z)] || (def.height > 1.2 && SOLID[this.world.getBlockId(x, column.y + 2, z)])) return null;
        return new THREE.Vector3(x, column.y + 0.5, z);
      }
    }
  }

  #findBank(x, z, radius) {
    for (let r = 1; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dz of [-r, r]) {
          for (const [bx, bz] of [[x + dx, z + dz], [x + dz, z + dx]]) {
            const column = this.#column(bx, bz);
            if (column && NATURAL_GROUND.has(column.top)) return { x: bx, z: bz, column };
          }
        }
      }
    }
    return null;
  }

  /** Top block of a loaded column, ignoring plants and leaves: { top, y } */
  #column(x, z) {
    if (!this.world.isLoadedAt(x, z)) return null;
    for (let y = this.world.chunkSize.height - 1; y >= 0; y--) {
      const id = this.world.getBlockId(x, y, z);
      if (id <= 0 || BLOCK_LAYER[id] === LAYER.plant) continue;
      if (LEAVES.has(id)) continue;
      return { top: id, y };
    }
    return null;
  }

  #pickWeighted(table) {
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return null;
    let roll = this.random() * total;
    for (const entry of table) {
      roll -= entry.weight;
      if (roll < 0) return entry.species;
    }
    return table[0].species;
  }

  #acquire(species, def, position, group) {
    const animal = this.#pool.pop() ?? new Animal();
    animal.reset(species, def, position, group, this.random() * Math.PI * 2, this.random() * 6);
    animal.timer = this.random() * 2;
    if (def.habitat === "flutter") animal.home.copy(position);
    this.animals.push(animal);
    return animal;
  }

  #release(index) {
    const [animal] = this.animals.splice(index, 1);
    // The herd stays together: the first follower takes over as leader
    let successor = null;
    for (const other of this.animals) {
      if (other.leader !== animal) continue;
      if (!successor) {
        successor = other;
        other.leader = null;
      } else {
        other.leader = successor;
      }
    }
    this.#pool.push(animal);
  }

  //! Behaviour

  #think(animal, dt, context, playerDistance) {
    const def = animal.def;
    const player = context.player.position;
    const sleepy = def.sleeps === "night" ? context.night > 0.6 : def.sleeps === "day" ? context.night < 0.3 : false;

    if (sleepy && animal.state !== "flee" && animal.state !== "sleep") animal.setState("sleep", 0);
    if (!sleepy && animal.state === "sleep") animal.setState("idle", this.random() * 2);

    // Shy animals bolt when the player gets close (sleeping ones only when very close), with their
    // group. True 3D distance: a player flying high overhead is no threat.
    const scare = animal.state === "sleep" ? def.flee / 2 : def.flee;
    if (def.flee > 0 && animal.state !== "flee" && animal.position.distanceTo(player) < scare) {
      for (const member of this.animals) {
        if (member.group === animal.group) member.setState("flee", 3 + this.random() * 2);
      }
    }
    animal.rest += ((animal.state === "sleep" ? 1 : 0) - animal.rest) * Math.min(1, dt * 2);

    switch (def.habitat) {
      case "air":
        return this.#thinkFlyer(animal, dt, player);
      case "flutter":
        return this.#thinkFlutter(animal, dt);
      case "water":
        return this.#thinkSwimmer(animal, dt, player);
      default:
        return this.#thinkWalker(animal, dt, player);
    }
  }

  #thinkWalker(animal, dt, player) {
    const def = animal.def;
    let targetPitch = 0;
    switch (animal.state) {
      case "idle": {
        animal.timer -= dt;
        const leader = animal.leader;
        // Herd members set off as soon as the leader moves away, not when they finish idling
        if (leader && this.animals.includes(leader) && animal.position.distanceTo(leader.position) > 6) {
          animal.timer = 0;
        }
        if (animal.timer > 0) break;
        if (leader && this.animals.includes(leader) && animal.position.distanceTo(leader.position) > 3) {
          animal.target.copy(leader.position).add(animal.offset);
          animal.setState("wander", 8);
          break;
        }
        // Leaders wait for stragglers: walk back towards the group before roaming on
        if (!leader) {
          const centre = this.#groupCentre(animal);
          if (centre && animal.position.distanceTo(centre) > 4) {
            animal.target.copy(centre);
            animal.setState("wander", 8);
            break;
          }
        }
        const roll = this.random();
        if (def.grazes && roll < 0.35) {
          animal.setState("graze", 3 + this.random() * 4);
        } else if (def.drinks && roll < 0.5) {
          // Herd members only drink from water right beside them; the leader takes the herd to water
          const following = leader && this.animals.includes(leader);
          const water = this.#findWater(animal.position.x, animal.position.y + 0.5, animal.position.z, following ? 2 : 7);
          if (water) {
            animal.target.copy(water.stand);
            animal.lookAt = water.water;
            animal.setState("drink", 12);
          } else {
            animal.setState("idle", 1 + this.random() * 2);
          }
        } else {
          // Group members wander around their leader, leaders roam freely
          const following = leader && this.animals.includes(leader);
          const origin = following ? _position.copy(leader.position).add(animal.offset) : animal.position;
          const angle = this.random() * Math.PI * 2;
          // Leaders of a herd take shorter strolls so the group can keep up
          const hasHerd = !following && this.animals.some((other) => other.leader === animal);
          const distance = following ? this.random() * 3 : hasHerd ? 3 + this.random() * 5 : 4 + this.random() * 8;
          animal.target.set(origin.x + Math.cos(angle) * distance, animal.position.y, origin.z + Math.sin(angle) * distance);
          animal.setState("wander", 10);
        }
        break;
      }
      case "wander": {
        animal.timer -= dt;
        // Keep up with a leader that has moved on
        const leader = animal.leader;
        if (leader && this.animals.includes(leader) && animal.target.distanceTo(leader.position) > 6) {
          animal.target.copy(leader.position).add(animal.offset);
        }
        const result = this.#walk(animal, animal.target, def.speed, dt);
        if (result !== "moving" || animal.timer <= 0) animal.setState("idle", 1 + this.random() * 3);
        break;
      }
      case "graze":
        targetPitch = 0.55;
        animal.timer -= dt;
        if (animal.timer <= 0) animal.setState("idle", 1 + this.random() * 2);
        break;
      case "drink": {
        animal.timer -= dt;
        const result = this.#walk(animal, animal.target, def.speed, dt);
        if (result === "reached") {
          // Face the water and lower the head
          animal.targetYaw = Math.atan2(animal.lookAt.x - animal.position.x, animal.lookAt.z - animal.position.z);
          targetPitch = 0.5;
          animal.drinking += dt;
          if (animal.drinking > 4) animal.setState("idle", 2);
        } else if (result === "blocked" || animal.timer <= 0) {
          animal.setState("idle", 1);
        }
        break;
      }
      case "flee": {
        animal.timer -= dt;
        const away = _position.set(animal.position.x - player.x, 0, animal.position.z - player.z);
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        away.normalize().multiplyScalar(6);
        animal.target.set(animal.position.x + away.x + animal.dodge.x, animal.position.y, animal.position.z + away.z + animal.dodge.z);
        const result = this.#walk(animal, animal.target, def.run, dt);
        if (result === "blocked") animal.dodge.set((this.random() - 0.5) * 12, 0, (this.random() - 0.5) * 12);
        if (animal.timer <= 0 && Math.hypot(animal.position.x - player.x, animal.position.z - player.z) > def.flee * 1.4) {
          animal.setState("idle", 1 + this.random() * 2);
        }
        break;
      }
      case "sleep":
        break;
    }
    animal.pitch += (targetPitch - animal.pitch) * Math.min(1, dt * 4);
    this.#turn(animal, dt, 5);
  }

  /** Average position of the animal's group when it is spread out (> 8 blocks), else null */
  #groupCentre(animal) {
    let count = 0;
    let spread = 0;
    const centre = new THREE.Vector3();
    for (const other of this.animals) {
      if (other.group !== animal.group) continue;
      centre.add(other.position);
      spread = Math.max(spread, other.position.distanceTo(animal.position));
      count++;
    }
    return count > 1 && spread > 8 ? centre.divideScalar(count) : null;
  }

  /** Steps towards target on the terrain. @returns "moving" | "reached" | "blocked" */
  #walk(animal, target, speed, dt) {
    const dx = target.x - animal.position.x;
    const dz = target.z - animal.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.35) return "reached";
    const step = Math.min(distance, speed * dt);
    const nx = animal.position.x + (dx / distance) * step;
    const nz = animal.position.z + (dz / distance) * step;
    animal.targetYaw = Math.atan2(dx, dz);

    const ground = this.groundAt(nx, nz, animal.position.y);
    const def = animal.def;
    if (!ground) return "blocked";
    if (ground.water && def.habitat === "land") return "blocked";
    if (ground.y - animal.position.y > 1.01 || animal.position.y - ground.y > 3) return "blocked";
    if (def.height > 1.2 && SOLID[this.world.getBlockId(Math.round(nx), Math.round(ground.y + 0.5) + 1, Math.round(nz))]) return "blocked";

    animal.position.x = nx;
    animal.position.z = nz;
    // Ease up / down steps instead of popping
    animal.position.y += (ground.y - animal.position.y) * Math.min(1, dt * 14);
    animal.moved += step;
    return "moving";
  }

  /**
   * Standing height (feet y) near fromY at (x, z): the top of a solid block
   * with free space above. `water` is true when that spot is under water.
   */
  groundAt(x, z, fromY) {
    const bx = Math.round(x);
    const bz = Math.round(z);
    const feetCell = Math.round(fromY + 0.5);
    for (let y = feetCell + 2; y >= feetCell - 4; y--) {
      const below = this.world.getBlockId(bx, y - 1, bz);
      if (below < 0) return null;
      const here = this.world.getBlockId(bx, y, bz);
      if (SOLID[below] && !SOLID[here]) return { y: y - 0.5, water: here === WATER };
    }
    return null;
  }

  /** A water block within `radius` and a dry spot next to it to stand on */
  #findWater(x, y, z, radius) {
    const bx = Math.round(x);
    const by = Math.round(y);
    const bz = Math.round(z);
    for (let r = 1; r <= radius; r++) {
      for (let i = 0; i < 8 * r; i++) {
        const angle = (i / (8 * r)) * Math.PI * 2;
        const wx = bx + Math.round(Math.cos(angle) * r);
        const wz = bz + Math.round(Math.sin(angle) * r);
        for (let dy = -2; dy <= 1; dy++) {
          if (this.world.getBlockId(wx, by + dy - 1, wz) !== WATER || this.world.getBlockId(wx, by + dy, wz) === WATER) continue;
          // Stand one step back towards the animal
          const sx = wx - Math.sign(wx - bx);
          const sz = wz - Math.sign(wz - bz);
          const stand = this.groundAt(sx, sz, by + dy - 0.5);
          if (stand && !stand.water) return { water: new THREE.Vector3(wx, by + dy - 1, wz), stand: new THREE.Vector3(sx, stand.y, sz) };
        }
      }
    }
    return null;
  }

  #thinkFlyer(animal, dt, player) {
    const def = animal.def;
    if (animal.state === "sleep") return; // roosting: hidden until morning
    const leader = animal.leader && this.animals.includes(animal.leader) ? animal.leader : null;
    if (leader) {
      animal.target.copy(leader.position).add(animal.offset);
    } else if (animal.position.distanceTo(animal.target) < 3 || animal.timer <= 0) {
      // Wander, but drift back towards the player's area
      const toPlayer = Math.hypot(player.x - animal.position.x, player.z - animal.position.z);
      const angle = toPlayer > this.spawnRadius * 0.8 ? Math.atan2(player.z - animal.position.z, player.x - animal.position.x) : this.random() * Math.PI * 2;
      const tx = animal.position.x + Math.cos(angle) * (15 + this.random() * 20);
      const tz = animal.position.z + Math.sin(angle) * (15 + this.random() * 20);
      const ground = this.world.isLoadedAt(tx, tz) ? this.world.getSurfaceHeight(Math.round(tx), Math.round(tz)) : animal.position.y - 10;
      animal.target.set(tx, ground + 8 + this.random() * 10, tz);
      animal.timer = 8;
    }
    animal.timer -= dt;
    const dx = animal.target.x - animal.position.x;
    const dz = animal.target.z - animal.position.z;
    animal.targetYaw = Math.atan2(dx, dz);
    this.#turn(animal, dt, 2.2);
    const speed = leader ? Math.min(def.run, Math.hypot(dx, dz) * 1.2 + def.speed * 0.5) : def.speed;
    animal.position.x += Math.sin(animal.yaw) * speed * dt;
    animal.position.z += Math.cos(animal.yaw) * speed * dt;
    // Never fly into the ground
    const floor = this.world.getSurfaceHeight(Math.round(animal.position.x), Math.round(animal.position.z)) + 2;
    animal.target.y = Math.max(animal.target.y, floor + 1);
    animal.position.y += Math.sign(animal.target.y - animal.position.y) * Math.min(Math.abs(animal.target.y - animal.position.y), 2.5 * dt);
    animal.position.y = Math.max(animal.position.y, floor);
    animal.pitch = Math.max(-0.4, Math.min(0.4, (animal.position.y - animal.target.y) * 0.1));
    animal.flap += dt * 14;
  }

  #thinkFlutter(animal, dt) {
    if (animal.state === "sleep") return;
    if (animal.position.distanceTo(animal.target) < 0.3 || animal.timer <= 0) {
      const ground = this.groundAt(animal.home.x, animal.home.z, animal.home.y) ?? { y: animal.home.y - 1 };
      animal.target.set(
        animal.home.x + (this.random() - 0.5) * 6,
        ground.y + 0.6 + this.random() * 1.6,
        animal.home.z + (this.random() - 0.5) * 6
      );
      animal.timer = 2 + this.random() * 3;
    }
    animal.timer -= dt;
    const dx = animal.target.x - animal.position.x;
    const dy = animal.target.y - animal.position.y;
    const dz = animal.target.z - animal.position.z;
    const distance = Math.hypot(dx, dy, dz) || 1;
    const step = Math.min(distance, animal.def.speed * dt);
    animal.position.x += (dx / distance) * step;
    animal.position.y += (dy / distance) * step + Math.sin(animal.flap * 0.3) * dt * 0.4;
    animal.position.z += (dz / distance) * step;
    animal.targetYaw = Math.atan2(dx, dz);
    this.#turn(animal, dt, 8);
    animal.flap += dt * 30;
  }

  #thinkSwimmer(animal, dt, player) {
    const def = animal.def;
    const isWater = (x, y, z) => this.world.getBlockId(Math.round(x), Math.round(y), Math.round(z)) === WATER;
    if (animal.state === "flee") {
      animal.timer -= dt;
      const angle = Math.atan2(animal.position.z - player.z, animal.position.x - player.x);
      animal.target.set(animal.position.x + Math.cos(angle) * 4, animal.position.y, animal.position.z + Math.sin(angle) * 4);
      if (animal.timer <= 0) animal.setState("idle", 0);
    } else if (animal.position.distanceTo(animal.target) < 0.4 || animal.timer <= 0 || !isWater(animal.target.x, animal.target.y, animal.target.z)) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const tx = animal.position.x + (this.random() - 0.5) * 10;
        const ty = animal.position.y + (this.random() - 0.5) * 2;
        const tz = animal.position.z + (this.random() - 0.5) * 10;
        if (isWater(tx, ty, tz)) {
          animal.target.set(tx, ty, tz);
          break;
        }
      }
      animal.timer = 3 + this.random() * 4;
    }
    animal.timer -= dt;
    const speed = animal.state === "flee" ? def.run : def.speed;
    const dx = animal.target.x - animal.position.x;
    const dy = animal.target.y - animal.position.y;
    const dz = animal.target.z - animal.position.z;
    const distance = Math.hypot(dx, dy, dz) || 1;
    const step = Math.min(distance, speed * dt);
    const nx = animal.position.x + (dx / distance) * step;
    const ny = animal.position.y + (dy / distance) * step;
    const nz = animal.position.z + (dz / distance) * step;
    // Fish never leave the water
    if (isWater(nx, ny, nz)) animal.position.set(nx, ny, nz);
    else animal.timer = 0;
    animal.targetYaw = Math.atan2(dx, dz);
    this.#turn(animal, dt, 4);
    animal.flap += dt * 10;
  }

  #turn(animal, dt, rate) {
    const delta = angleDelta(animal.yaw, animal.targetYaw);
    animal.yaw += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
  }

  //! Rendering

  #render() {
    for (const mesh of Object.values(this.#meshes)) mesh.count = 0;
    for (const animal of this.animals) {
      const mesh = this.#meshes[animal.species];
      if (!mesh || mesh.count >= MAX_PER_SPECIES) continue;
      const def = animal.def;
      let lift = 0;
      if (def.hop && animal.moved > 0) lift = Math.abs(Math.sin(animal.moved * 2.2)) * 0.35;
      else if (animal.moved > 0) lift = Math.abs(Math.sin(animal.moved * 3)) * 0.04;
      // Asleep: lie down (flyers roost out of sight)
      const hidden = animal.state === "sleep" && (def.habitat === "air" || def.habitat === "flutter");
      const squash = 1 - animal.rest * 0.3;
      _position.set(animal.position.x, animal.position.y + lift - animal.rest * 0.1, animal.position.z);
      _euler.set(animal.pitch, animal.yaw, animal.rest * 0.25);
      _quaternion.setFromEuler(_euler);
      const flap = def.flap ? 1 + Math.sin(animal.flap) * 0.55 : 1;
      if (hidden) _scale.set(0, 0, 0);
      else _scale.set(flap, squash, 1);
      _matrix.compose(_position, _quaternion, _scale);
      mesh.setMatrixAt(mesh.count++, _matrix);
    }
    for (const mesh of Object.values(this.#meshes)) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const mesh of Object.values(this.#meshes)) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.animals.length = 0;
    this.#pool.length = 0;
  }
}

/** One animal's state (pooled and reused) */
class Animal {
  position = new THREE.Vector3();
  target = new THREE.Vector3();
  offset = new THREE.Vector3();
  home = new THREE.Vector3();
  dodge = new THREE.Vector3();
  lookAt = new THREE.Vector3();

  reset(species, def, position, group, yaw, flapPhase) {
    this.species = species;
    this.def = def;
    this.position.copy(position);
    this.target.copy(position);
    this.dodge.set(0, 0, 0);
    this.group = group;
    this.leader = null;
    this.yaw = this.targetYaw = yaw;
    this.pitch = 0;
    this.rest = 0;
    this.moved = 0;
    this.flap = flapPhase;
    this.pending = 0;
    this.setState("idle", 0);
  }

  setState(state, timer) {
    this.state = state;
    this.timer = timer;
    this.drinking = 0;
    if (state !== "flee") this.dodge.set(0, 0, 0);
  }
}
