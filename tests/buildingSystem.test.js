import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blocks } from "../scripts/blocks";
import { BuildingSystem } from "../scripts/building/buildingSystem";
import { Inventory } from "../scripts/building/inventory";
import { createTestPlayer, createTestWorld, findRenderingMismatches } from "./helpers";

// Floating anchor block well above the terrain (max terrain height is ~22 of 32)
const ANCHOR = new THREE.Vector3(5, 26, 5);
const FACES = [
  ["top", [0, 1, 0]],
  ["bottom", [0, -1, 0]],
  ["east", [1, 0, 0]],
  ["west", [-1, 0, 0]],
  ["south", [0, 0, 1]],
  ["north", [0, 0, -1]],
];

let world, player, inventory, system, effects;

beforeEach(() => {
  world = createTestWorld();
  player = createTestPlayer();
  inventory = new Inventory();
  effects = { onPlace: vi.fn(), onBreak: vi.fn() };
  system = new BuildingSystem({ scene: new THREE.Scene(), world, player, inventory, effects });
  world.setBlock(ANCHOR.x, ANCHOR.y, ANCHOR.z, blocks.stone.id);
});

afterEach(() => system.dispose());

/**
 * Puts the eye `distance` blocks away from the anchor along a face normal, looking at it.
 * Above the block the eye must be 4 up, or the player's own body would block the cell.
 */
function lookAtFace(normal, distance = normal[1] === 1 ? 4 : 3) {
  player.position.copy(ANCHOR).addScaledVector(new THREE.Vector3(...normal), distance);
  // Avoid a degenerate lookAt when looking straight up / down
  if (normal[1] !== 0) player.position.x += 0.0001;
  player.camera.lookAt(ANCHOR);
  system.update(true);
}

describe("block placement", () => {
  it.each(FACES)("places on the %s face, snapped to the grid", (_, normal) => {
    lookAtFace(normal);
    expect(system.targeting.target.position.toArray()).toEqual(ANCHOR.toArray());

    const expected = ANCHOR.clone().add(new THREE.Vector3(...normal));
    expect(system.targeting.placement.toArray()).toEqual(expected.toArray());
    expect(system.placeBlock()).toEqual({ ok: true });
    expect(world.getBlock(expected.x, expected.y, expected.z).id).toBe(inventory.selectedBlockId);
    expect(effects.onPlace).toHaveBeenCalledOnce();
  });

  it("builds a straight tower by repeatedly placing on top", () => {
    for (let i = 1; i <= 3; i++) {
      player.position.set(ANCHOR.x + 3, ANCHOR.y + i + 1, ANCHOR.z + 0.0001);
      player.camera.lookAt(ANCHOR.x, ANCHOR.y + i - 0.6, ANCHOR.z);
      system.update(true);
      expect(system.placeBlock().ok).toBe(true);
    }
    for (let i = 0; i <= 3; i++) expect(world.getBlock(ANCHOR.x, ANCHOR.y + i, ANCHOR.z).id).not.toBe(0);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("never places into an occupied cell", () => {
    world.setBlock(ANCHOR.x, ANCHOR.y + 1, ANCHOR.z, blocks.dirt.id);
    const error = system.targeting.getPlaceError(new THREE.Vector3(ANCHOR.x, ANCHOR.y + 1, ANCHOR.z), blocks.stone.id);
    expect(error).toBe("Space is occupied");
  });

  it("rejects off-grid, out-of-world and unplaceable placements", () => {
    const t = system.targeting;
    player.position.set(0, 20, 0);
    expect(t.getPlaceError(new THREE.Vector3(1.5, 25, 1), blocks.stone.id)).toMatch(/grid/);
    expect(t.getPlaceError(new THREE.Vector3(1, 40, 1), blocks.stone.id)).toMatch(/Outside/);
    expect(t.getPlaceError(new THREE.Vector3(1, 25, 1), blocks.empty.id)).toMatch(/can't be placed/);
    expect(t.getPlaceError(new THREE.Vector3(1, 25, 30), blocks.stone.id)).toMatch(/far/);
  });

  it("won't place a solid block inside the player, but allows water", () => {
    // Eye just above the anchor's top face: the cell above the anchor overlaps the body
    player.position.set(ANCHOR.x + 0.0001, ANCHOR.y + 1.2, ANCHOR.z);
    player.camera.lookAt(ANCHOR);
    system.update(true);
    expect(system.targeting.placement).toBeNull();
    expect(system.placeBlock()).toEqual({ ok: false, error: "You're in the way" });

    inventory.assign(blocks.water.id);
    system.update(true);
    expect(system.placeBlock().ok).toBe(true);
  });

  it("does nothing in explore mode", () => {
    system.toggleMode();
    lookAtFace([0, 1, 0]);
    expect(system.targeting.target).toBeNull();
    expect(system.placeBlock()).toEqual({ ok: false, error: null });
  });

  it("respects the configured reach", () => {
    system.targeting.reach = 2;
    lookAtFace([1, 0, 0], 4);
    expect(system.targeting.target).toBeNull();
  });
});

describe("block destruction", () => {
  it("removes the targeted block and plays effects", () => {
    lookAtFace([0, 1, 0]);
    expect(system.removeBlock()).toEqual({ ok: true });
    expect(world.getBlock(ANCHOR.x, ANCHOR.y, ANCHOR.z).id).toBe(blocks.empty.id);
    expect(effects.onBreak).toHaveBeenCalledWith({ x: 5, y: 26, z: 5 }, blocks.stone);
  });

  it("protects the base layer", () => {
    expect(system.targeting.getRemoveError(new THREE.Vector3(0, 0, 0))).toMatch(/base layer/);
  });

  it("protects blocks marked unbreakable in the registry", () => {
    blocks.stone.breakable = false;
    try {
      expect(system.targeting.getRemoveError(ANCHOR)).toMatch(/unbreakable/);
    } finally {
      delete blocks.stone.breakable;
    }
  });
});

describe("undo / redo", () => {
  it("undoes and redoes placement and destruction", () => {
    lookAtFace([0, 1, 0]);
    system.placeBlock();
    const above = [ANCHOR.x, ANCHOR.y + 1, ANCHOR.z];
    expect(world.getBlock(...above).id).toBe(inventory.selectedBlockId);

    system.update(true);
    system.removeBlock(); // removes the block just placed
    expect(world.getBlock(...above).id).toBe(0);

    expect(system.undo().ok).toBe(true); // restore it
    expect(world.getBlock(...above).id).toBe(inventory.selectedBlockId);
    expect(system.undo().ok).toBe(true); // un-place it
    expect(world.getBlock(...above).id).toBe(0);
    expect(system.undo()).toEqual({ ok: false, error: "Nothing to undo" });

    expect(system.redo().ok).toBe(true);
    expect(world.getBlock(...above).id).toBe(inventory.selectedBlockId);
    expect(system.redo().ok).toBe(true);
    expect(world.getBlock(...above).id).toBe(0);
    expect(system.redo()).toEqual({ ok: false, error: "Nothing to redo" });
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("notifies listeners of every change (used for autosave)", () => {
    const listener = vi.fn();
    system.onChange(listener);
    lookAtFace([0, 1, 0]);
    system.placeBlock();
    system.undo();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("pick block", () => {
  it("puts the targeted block type in the selected slot", () => {
    world.setBlock(ANCHOR.x, ANCHOR.y, ANCHOR.z, blocks.brick.id);
    lookAtFace([0, 1, 0]);
    expect(system.pickBlock().ok).toBe(true);
    expect(inventory.selectedBlockId).toBe(blocks.brick.id);
  });
});

describe("building in and around water", () => {
  it("places into water (replacing it) and aims through water when submerged", () => {
    // A small pool: water at y = 27..28 above the anchor
    for (let x = 4; x <= 6; x++) for (let z = 4; z <= 6; z++) for (let y = 27; y <= 28; y++) world.setBlock(x, y, z, blocks.water.id);
    // Eye under water, beside the anchor and looking at it: the water around is ignored
    player.position.set(5.0001, 28.4, 6.2);
    player.camera.lookAt(ANCHOR);
    system.update(true);
    expect(system.targeting.target.position.toArray()).toEqual(ANCHOR.toArray());
    const cell = system.targeting.placement.clone();
    expect(world.getBlock(cell.x, cell.y, cell.z).id).toBe(blocks.water.id);
    expect(system.placeBlock().ok).toBe(true);
    expect(world.getBlock(cell.x, cell.y, cell.z).id).toBe(inventory.selectedBlockId);

    // From above the surface, aiming at water replaces the water block
    player.position.set(5.0001, 32, 5);
    player.camera.lookAt(5, 28, 5);
    system.update(true);
    expect(system.targeting.target.position.toArray()).toEqual([5, 28, 5]);
    expect(system.placeBlock().ok).toBe(true);
    expect(world.getBlock(5, 28, 5).id).toBe(inventory.selectedBlockId);
  });
});
