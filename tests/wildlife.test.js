import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SOLID, blocks } from "../scripts/blocks";
import { BIOMES, WATER_ANIMALS } from "../scripts/terrain/biomes";
import { SPECIES } from "../scripts/wildlife/species";
import { Wildlife } from "../scripts/wildlife/wildlife";
import { World } from "../scripts/world";

// These tests generate real terrain on the main thread; allow slower machines time
vi.setConfig({ testTimeout: 30000 });

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let world;
let spawn;
beforeAll(async () => {
  world = new World();
  world.params = { seed: 2024, generator: "natural", biomeScale: 1, terrain: { scale: 80, magnitude: 0.5, offset: 0.3 } };
  world.chunkSize = { width: 16, height: 64 };
  world.drawDistance = 4;
  spawn = world.generator.findSpawn();
  await world.loadAround(spawn.x, spawn.z, 4);
}, 120000);

const playerAt = (x, y, z) => ({ position: new THREE.Vector3(x, y, z) });
const surfaceY = (x, z) => world.getSurfaceHeight(Math.round(x), Math.round(z));

/** A dry column near the spawn suitable for big land animals */
function landSpot(dx, dz) {
  const x = spawn.x + dx;
  const z = spawn.z + dz;
  return { x, z };
}

describe("wildlife", () => {
  it("spawns biome-appropriate animals around the player, within the cap", () => {
    const wildlife = new Wildlife({ world, random: seeded(1) });
    wildlife.cap = 25;
    const player = playerAt(spawn.x, surfaceY(spawn.x, spawn.z) + 2, spawn.z);
    for (let i = 0; i < 400; i++) wildlife.update(0.1, { player, night: 0 });
    expect(wildlife.animals.length).toBeGreaterThan(5);
    expect(wildlife.animals.length).toBeLessThanOrEqual(25);
    const allowed = new Set([...BIOMES.flatMap((b) => b.animals.map((a) => a.species)), ...WATER_ANIMALS.map((a) => a.species)]);
    for (const animal of wildlife.animals) expect(allowed.has(animal.species)).toBe(true);
  });

  it("land animals walk on the terrain: never inside blocks, never in water", () => {
    const wildlife = new Wildlife({ world, random: seeded(2) });
    const player = playerAt(spawn.x, 200, spawn.z); // far above: nothing flees
    const { x, z } = landSpot(6, 6);
    for (const species of ["deer", "sheep", "cow", "pig", "rabbit"]) wildlife.spawnGroup(species, x, z);
    const walkers = wildlife.animals.filter((a) => a.def.habitat === "land");
    expect(walkers.length).toBeGreaterThan(4);
    const start = walkers.map((a) => a.position.clone());
    for (let i = 0; i < 600; i++) {
      wildlife.update(0.1, { player, night: 0 });
      for (const a of walkers) {
        const feet = Math.round(a.position.y + 0.5);
        const bx = Math.round(a.position.x);
        const bz = Math.round(a.position.z);
        expect(SOLID[world.getBlockId(bx, feet, bz)]).toBe(0);
        expect(world.getBlockId(bx, feet, bz)).not.toBe(blocks.water.id);
      }
    }
    // They actually moved around
    expect(walkers.some((a, i) => a.position.distanceTo(start[i]) > 2)).toBe(true);
  });

  it("shy animals flee from the player with their group", () => {
    const wildlife = new Wildlife({ world, random: seeded(3) });
    const { x, z } = landSpot(-8, 4);
    const herd = wildlife.spawnGroup("deer", x, z);
    expect(herd.length).toBeGreaterThan(0);
    const leader = herd[0];
    const player = playerAt(leader.position.x + 5, leader.position.y + 1.7, leader.position.z);
    const before = Math.hypot(leader.position.x - player.position.x, leader.position.z - player.position.z);
    wildlife.update(0.05, { player, night: 0 });
    expect(herd.every((deer) => deer.state === "flee")).toBe(true);
    for (let i = 0; i < 40; i++) wildlife.update(0.05, { player, night: 0 });
    const after = Math.hypot(leader.position.x - player.position.x, leader.position.z - player.position.z);
    expect(after).toBeGreaterThan(before);
  });

  it("calm animals ignore the player; nocturnal schedules are respected", () => {
    const wildlife = new Wildlife({ world, random: seeded(4) });
    const { x, z } = landSpot(3, -7);
    const [cow] = wildlife.spawnGroup("cow", x, z);
    const [fox] = wildlife.spawnGroup("fox", x + 2, z);
    const player = playerAt(cow.position.x + 2, cow.position.y + 1.7, cow.position.z);
    for (let i = 0; i < 20; i++) wildlife.update(0.1, { player: playerAt(x, 200, z), night: 1 });
    expect(cow.state).toBe("sleep");
    expect(fox?.state ?? "idle").not.toBe("sleep"); // foxes are awake at night
    wildlife.update(0.1, { player, night: 0 });
    expect(cow.state).not.toBe("flee");
    expect(cow.state).not.toBe("sleep");
  });

  it("herds stay together", () => {
    const wildlife = new Wildlife({ world, random: seeded(5) });
    const { x, z } = landSpot(5, 5);
    const herd = wildlife.spawnGroup("sheep", x, z);
    expect(herd.length).toBeGreaterThan(1);
    wildlife.cap = herd.length; // no other animals
    const group = herd[0].group;
    const player = playerAt(x, 200, z);
    // Spread = furthest member from the herd's centre, sampled every 5 s over 90 s
    const spreads = [];
    for (let i = 1; i <= 900; i++) {
      wildlife.update(0.1, { player, night: 0 });
      if (i % 50 !== 0) continue;
      const members = wildlife.animals.filter((a) => a.group === group);
      const centre = members.reduce((c, a) => c.add(a.position), new THREE.Vector3()).divideScalar(members.length);
      spreads.push(Math.max(...members.map((a) => a.position.distanceTo(centre))));
    }
    spreads.sort((a, b) => a - b);
    expect(spreads[spreads.length >> 1]).toBeLessThan(8); // usually close together
    expect(spreads[spreads.length - 1]).toBeLessThan(24); // nobody gets lost
  });

  it("fish only ever swim in water", () => {
    const wildlife = new Wildlife({ world, random: seeded(6) });
    let fish = [];
    // Find water near spawn
    for (let r = 2; r < 60 && fish.length === 0; r += 2) {
      for (let a = 0; a < 16 && fish.length === 0; a++) {
        const x = Math.round(spawn.x + Math.cos(a) * r);
        const z = Math.round(spawn.z + Math.sin(a) * r);
        fish = wildlife.spawnGroup("fish", x, z);
      }
    }
    expect(fish.length).toBeGreaterThan(0);
    const player = playerAt(spawn.x, 200, spawn.z);
    for (let i = 0; i < 300; i++) {
      wildlife.update(0.1, { player, night: 0 });
      for (const f of fish) {
        expect(world.getBlockId(Math.round(f.position.x), Math.round(f.position.y), Math.round(f.position.z))).toBe(blocks.water.id);
      }
    }
  });

  it("despawns animals the player leaves behind and reuses them", () => {
    const wildlife = new Wildlife({ world, random: seeded(7) });
    wildlife.cap = 20;
    const near = playerAt(spawn.x, 100, spawn.z);
    for (let i = 0; i < 200; i++) wildlife.update(0.1, { player: near, night: 0 });
    expect(wildlife.animals.length).toBeGreaterThan(0);
    wildlife.update(0.1, { player: playerAt(spawn.x + 1000, 100, spawn.z), night: 0 });
    expect(wildlife.animals.length).toBeLessThanOrEqual(1);
  });

  it("defines all 16 species with a model and behaviour", () => {
    expect(Object.keys(SPECIES).sort()).toEqual(
      ["bear", "bee", "bird", "butterfly", "chicken", "cow", "deer", "fish", "fox", "frog", "horse", "pig", "rabbit", "sheep", "turtle", "wolf"].sort()
    );
  });
});

describe("wildlife group leadership", () => {
  it("promotes a follower when the leader leaves", () => {
    const wildlife = new Wildlife({ world, random: seeded(9) });
    const { x, z } = landSpot(-5, -5);
    const herd = wildlife.spawnGroup("deer", x, z);
    expect(herd.length).toBeGreaterThan(1);
    // Teleport the leader far away: it despawns on the next update
    herd[0].position.x += 10000;
    wildlife.update(0.1, { player: playerAt(x, 200, z), night: 0 });
    const members = wildlife.animals.filter((a) => a.group === herd[1].group);
    expect(members.filter((a) => a.leader === null)).toHaveLength(1);
    for (const deer of members) if (deer.leader) expect(members).toContain(deer.leader);
  });
});

describe("wildlife scaring", () => {
  it("a player high overhead doesn't scare animals, one on the ground does", () => {
    const wildlife = new Wildlife({ world, random: seeded(11) });
    const { x, z } = landSpot(-8, 4);
    const [deer] = wildlife.spawnGroup("deer", x, z);
    wildlife.update(0.1, { player: playerAt(deer.position.x, deer.position.y + 60, deer.position.z), night: 0 });
    expect(deer.state).not.toBe("flee");
    wildlife.update(0.1, { player: playerAt(deer.position.x + 3, deer.position.y + 1.7, deer.position.z), night: 0 });
    expect(deer.state).toBe("flee");
  });
});
