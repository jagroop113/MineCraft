import { describe, expect, it } from "vitest";
import { blocks } from "../scripts/blocks";
import { createTestWorld, findRenderingMismatches } from "./helpers";

function blockIds(world) {
  return world.children.map((chunk) => Array.from(chunk.blocks));
}

describe("World block editing", () => {
  it("generates a consistent world", () => {
    const world = createTestWorld();
    expect(world.children).toHaveLength(9);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("doesn't render blocks enclosed by a neighbouring chunk or the world floor", () => {
    const world = createTestWorld();
    // Blocks on the border between chunk (0,0) and (1,0), at x = 15 | 16
    const enclosed = [];
    for (let y = 0; y < 32; y++)
      for (let z = 1; z < 15; z++) {
        const solid = (x, yy, zz) => (yy < 0 ? true : (world.getBlock(x, yy, zz)?.id ?? 0) !== 0);
        const around = [[16, y, z], [14, y, z], [15, y + 1, z], [15, y - 1, z], [15, y, z + 1], [15, y, z - 1]];
        if (solid(15, y, z) && around.every((p) => solid(...p))) enclosed.push([15, y, z]);
      }
    expect(enclosed.length).toBeGreaterThan(0);
    const chunk = world.getChunk(0, 0);
    for (const [x, y, z] of enclosed) expect(chunk.getVisibleFaceCount(x, y, z)).toBe(0);

    // Digging next to one exposes exactly the face toward the hole
    const [x, y, z] = enclosed[0];
    world.setBlock(x + 1, y, z, blocks.empty.id);
    expect(chunk.getVisibleFaceCount(x, y, z)).toBe(1);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("renders only exposed faces, and hides faces between the same transparent block", () => {
    const world = createTestWorld();
    const chunk = world.getChunk(0, 0);
    world.setBlock(5, 30, 5, blocks.stone.id);
    expect(chunk.getVisibleFaceCount(5, 30, 5)).toBe(6);
    world.setBlock(6, 30, 5, blocks.stone.id);
    expect(chunk.getVisibleFaceCount(5, 30, 5)).toBe(5);

    world.setBlock(5, 30, 8, blocks.glass.id);
    world.setBlock(6, 30, 8, blocks.glass.id);
    expect(chunk.getVisibleFaceCount(5, 30, 8)).toBe(5);
    // A stone next to glass still shows the face behind the glass
    world.setBlock(7, 30, 8, blocks.stone.id);
    expect(chunk.getVisibleFaceCount(7, 30, 8)).toBe(6);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("places and removes blocks and records edits", () => {
    const world = createTestWorld();
    expect(world.setBlock(3, 30, 3, blocks.brick.id)).toBe(true);
    expect(world.getBlock(3, 30, 3).id).toBe(blocks.brick.id);
    expect(world.setBlock(3, 30, 3, blocks.empty.id)).toBe(true);
    expect(world.getBlock(3, 30, 3).id).toBe(blocks.empty.id);
    expect(world.getEdits()).toEqual([[3, 30, 3, blocks.empty.id]]);
  });

  it("rejects positions outside the world height or the loaded chunks", () => {
    const world = createTestWorld();
    expect(world.setBlock(0, 32, 0, blocks.stone.id)).toBe(false);
    expect(world.setBlock(0, -1, 0, blocks.stone.id)).toBe(false);
    expect(world.setBlock(100, 5, 0, blocks.stone.id)).toBe(false); // chunk not loaded
    expect(world.edits.size).toBe(0);
  });

  it("exposes hidden neighbours when digging and hides covered ones when building", () => {
    const world = createTestWorld();
    // Dig a 3x3x3 hole into the terrain, including across a chunk border (x = 15 | 16)
    for (let x = 14; x <= 16; x++)
      for (let y = 1; y <= 3; y++)
        for (let z = 5; z <= 7; z++) world.setBlock(x, y, z, blocks.empty.id);
    expect(findRenderingMismatches(world)).toEqual([]);

    // Fill it back with glass (transparent) and stone
    for (let x = 14; x <= 16; x++)
      for (let y = 1; y <= 3; y++)
        for (let z = 5; z <= 7; z++) world.setBlock(x, y, z, y === 2 ? blocks.glass.id : blocks.stone.id);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("removing a block leaves its neighbours' types untouched", () => {
    const world = createTestWorld();
    world.setBlock(5, 28, 5, blocks.brick.id);
    world.setBlock(6, 28, 5, blocks.sand.id);
    world.setBlock(5, 29, 5, blocks.glass.id);
    world.setBlock(5, 28, 5, blocks.empty.id);
    expect(world.getBlock(6, 28, 5).id).toBe(blocks.sand.id);
    expect(world.getBlock(5, 29, 5).id).toBe(blocks.glass.id);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("handles thousands of placements (buffers grow, rendering stays consistent)", () => {
    const world = createTestWorld();
    const start = performance.now();
    let placed = 0;
    for (let x = -16; x < 32; x++)
      for (let z = -16; z < 32; z++)
        for (let y = 24; y < 26; y++) {
          world.setBlock(x, y, z, (x + z) % 2 ? blocks.brick.id : blocks.cobblestone.id);
          placed++;
        }
    const elapsed = performance.now() - start;
    expect(placed).toBe(4608);
    expect(elapsed).toBeLessThan(2000);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("re-applies edits when the world is regenerated", () => {
    const world = createTestWorld();
    world.setBlock(2, 30, 2, blocks.water.id);
    world.generate();
    expect(world.getBlock(2, 30, 2).id).toBe(blocks.water.id);
    expect(world.children).toHaveLength(9);
  });

  it("partial async regeneration matches a full rebuild", async () => {
    const world = createTestWorld();
    world.setEdits([
      [1, 30, 1, blocks.brick.id],
      [20, 30, 20, blocks.glass.id],
    ]);
    await world.generateAsync({ chunks: world.getEditedChunkKeys() });
    const partial = blockIds(world);
    world.generate();
    expect(blockIds(world)).toEqual(partial);
    expect(findRenderingMismatches(world)).toEqual([]);
  });

  it("finds the surface height", () => {
    const world = createTestWorld();
    const surface = world.getSurfaceHeight(4, 4);
    expect(world.getBlock(4, surface - 1, 4).id).not.toBe(blocks.empty.id);
    expect(world.getBlock(4, surface, 4)?.id ?? 0).toBe(blocks.empty.id);
  });
});
