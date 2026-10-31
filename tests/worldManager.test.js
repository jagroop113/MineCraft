import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blocks } from "../scripts/blocks";
import { Settings } from "../scripts/building/settings";
import { SAVE_VERSION } from "../scripts/building/saveFormat";
import { WorldManager } from "../scripts/building/worldManager";
import { MemoryBackend, WorldPersistence } from "../scripts/building/worldPersistence";
import { MemoryStorage, createTestPlayer, createTestWorld } from "./helpers";

// These tests generate real terrain on the main thread; allow slower machines time
vi.setConfig({ testTimeout: 30000 });

let storage, backend;

beforeEach(() => {
  storage = new MemoryStorage();
  backend = new MemoryBackend();
});

/** A fresh "page load": new world, player and manager over the same storage */
function boot() {
  const world = createTestWorld();
  const player = createTestPlayer();
  const manager = new WorldManager({
    world,
    player,
    persistence: new WorldPersistence(backend),
    settings: new Settings(storage),
    storage,
  });
  return { world, player, manager };
}

describe("WorldManager", () => {
  it("creates and saves a first world on first start", async () => {
    const { manager, player, world } = boot();
    expect(await manager.init()).toEqual([]);
    expect(manager.current.name).toBe("My World");
    expect(world.params.generator).toBe("natural");
    expect(await manager.listWorlds()).toHaveLength(1);
    // Player stands on the surface at the (dry) spawn point
    const spawn = manager.getSpawnPoint();
    expect(Math.floor(player.position.x)).toBe(spawn.x);
    expect(player.position.y - player.height).toBeCloseTo(world.getSurfaceHeight(spawn.x, spawn.z) - 0.5, 0);
    expect(world.getBlockId(spawn.x, world.getSurfaceHeight(spawn.x, spawn.z) - 1, spawn.z)).not.toBe(blocks.water.id);
  });

  it("restores blocks, player position and orientation after a reload", async () => {
    const first = boot();
    await first.manager.init();
    first.world.setBlock(3, 30, 3, blocks.brick.id);
    first.world.setBlock(4, 1, 4, blocks.empty.id);
    first.player.position.set(10, 30, 12);
    first.player.camera.quaternion.setFromEuler(new THREE.Euler(-0.4, 1.2, 0, "YXZ"));
    first.manager.markDirty();
    await first.manager.save();
    expect(first.manager.dirty).toBe(false);

    const second = boot();
    await second.manager.init();
    expect(second.world.getBlock(3, 30, 3).id).toBe(blocks.brick.id);
    expect(second.world.getBlock(4, 1, 4).id).toBe(blocks.empty.id);
    expect(second.player.position.toArray()).toEqual([10, 30, 12]);
    const euler = new THREE.Euler().setFromQuaternion(second.player.camera.quaternion, "YXZ");
    expect(euler.y).toBeCloseTo(1.2);
    expect(euler.x).toBeCloseTo(-0.4);
  });

  it("creates, switches between and deletes worlds", async () => {
    const { manager, world } = boot();
    await manager.init();
    const firstId = manager.current.id;
    world.setBlock(1, 30, 1, blocks.glass.id);
    manager.markDirty();

    await manager.createWorld({ name: "  Castle  ", seed: 42 });
    expect(manager.current.name).toBe("Castle");
    expect(world.params.seed).toBe(42);
    expect(world.getBlock(1, 30, 1).id).toBe(blocks.empty.id);

    // Switching saved the dirty first world
    await manager.loadWorld(firstId);
    expect(world.getBlock(1, 30, 1).id).toBe(blocks.glass.id);

    await manager.deleteWorld(firstId);
    expect(manager.current.name).toBe("Castle");
    expect((await manager.listWorlds()).map((w) => w.name)).toEqual(["Castle"]);
  });

  it("treats player movement as unsaved progress", async () => {
    const { manager, player } = boot();
    await manager.init();
    expect(manager.hasUnsavedChanges).toBe(false);
    player.position.x += 0.5;
    expect(manager.hasUnsavedChanges).toBe(false);
    player.position.x += 5;
    expect(manager.hasUnsavedChanges).toBe(true);
    await manager.saveIfNeeded();
    expect(manager.hasUnsavedChanges).toBe(false);
    const [meta] = await manager.listWorlds();
    const { save } = await manager.persistence.loadWorld(meta.id);
    expect(save.player.position[0]).toBeCloseTo(player.position.x);
  });

  it("resets the current world", async () => {
    const { manager, world } = boot();
    await manager.init();
    world.setBlock(1, 30, 1, blocks.glass.id);
    await manager.resetWorld();
    expect(world.getBlock(1, 30, 1).id).toBe(blocks.empty.id);
    expect(world.edits.size).toBe(0);
    const [meta] = await manager.listWorlds();
    expect(meta.editCount).toBe(0);
  });

  it("recovers the previous save when the latest is corrupted", async () => {
    const first = boot();
    await first.manager.init();
    first.world.setBlock(3, 30, 3, blocks.brick.id);
    await first.manager.save();
    first.world.setBlock(3, 30, 3, blocks.sand.id);
    await first.manager.save();
    const id = first.manager.current.id;
    await backend.write([{ store: "worlds", value: { id, version: SAVE_VERSION, params: "broken" } }]);

    const second = boot();
    const warnings = await second.manager.init();
    expect(warnings[0]).toMatch(/previous save was restored/);
    expect(second.world.getBlock(3, 30, 3).id).toBe(blocks.brick.id);
  });

  it("starts a new world when nothing loadable exists", async () => {
    const first = boot();
    await first.manager.init();
    const id = first.manager.current.id;
    await backend.write([
      { store: "worlds", value: { id, version: 999 } },
      { store: "backups", deleteId: id },
    ]);

    const second = boot();
    const warnings = await second.manager.init();
    expect(warnings.join(" ")).toMatch(/Couldn't open your last world/);
    expect(second.manager.current.id).not.toBe(id);
  });

  it("imports version 1 saves from the old localStorage slots", async () => {
    storage.setItem(
      "minecraft-js:world:0",
      JSON.stringify({
        version: 1,
        savedAt: 5,
        params: { seed: 0, terrain: { scale: 30, magnitude: 0.5, offset: 0.2 } },
        chunkSize: { width: 16, height: 32 },
        player: [8, 30, 8],
        edits: [[2, 30, 2, blocks.brick.id]],
      })
    );
    storage.setItem("minecraft-js:world:1", "{corrupted");

    const { manager } = boot();
    const warnings = await manager.init();
    expect(warnings.join(" ")).toMatch(/slot 2 couldn't be imported/);
    const names = (await manager.listWorlds()).map((w) => w.name);
    expect(names).toContain("Slot 1 (imported)");
    expect(storage.getItem("minecraft-js:world:0")).toBeNull();
    // The unreadable slot is kept aside, not destroyed
    expect(storage.getItem("minecraft-js:unreadable-world:1")).toBe("{corrupted");
  });

  it("moves a player saved inside a block back to the surface", async () => {
    const first = boot();
    await first.manager.init();
    first.player.position.set(4, 3, 4); // underground
    await first.manager.save();

    const second = boot();
    await second.manager.init();
    const spawn = second.manager.getSpawnPoint();
    expect(Math.floor(second.player.position.x)).toBe(spawn.x);
    expect(second.player.position.y).toBeGreaterThan(second.world.getSurfaceHeight(spawn.x, spawn.z));
  });
});
