import { describe, expect, it } from "vitest";
import { blocks } from "../scripts/blocks";
import { SAVE_VERSION, decodeEdits, encodeEdits } from "../scripts/building/saveFormat";
import { MemoryBackend, WorldPersistence } from "../scripts/building/worldPersistence";

function save(id, edits, updatedAt = Date.now()) {
  return {
    version: SAVE_VERSION,
    id,
    name: id,
    createdAt: 1,
    updatedAt,
    params: { seed: 1, terrain: { scale: 30, magnitude: 0.5, offset: 0.2 } },
    chunkSize: { width: 64, height: 32 },
    player: null,
    edits: encodeEdits(edits),
  };
}

describe("WorldPersistence", () => {
  it("saves, lists and loads worlds", async () => {
    const persistence = new WorldPersistence(new MemoryBackend());
    await persistence.saveWorld(save("a", [[1, 1, 1, blocks.stone.id]], 100));
    await persistence.saveWorld(save("b", [], 200));

    const list = await persistence.listWorlds();
    expect(list.map((w) => w.id)).toEqual(["b", "a"]);
    expect(list[1].editCount).toBe(1);

    const { save: loaded, recovered } = await persistence.loadWorld("a");
    expect(recovered).toBe(false);
    expect(decodeEdits(loaded.edits)).toEqual([[1, 1, 1, blocks.stone.id]]);
  });

  it("refuses to write invalid data", async () => {
    const persistence = new WorldPersistence(new MemoryBackend());
    await expect(persistence.saveWorld({ ...save("a", []), chunkSize: null })).rejects.toThrow();
    expect(await persistence.listWorlds()).toEqual([]);
  });

  it("recovers the previous save when the latest one is corrupted", async () => {
    const backend = new MemoryBackend();
    const persistence = new WorldPersistence(backend);
    await persistence.saveWorld(save("a", [[1, 1, 1, blocks.stone.id]]));
    await persistence.saveWorld(save("a", [[2, 2, 2, blocks.brick.id]]));

    // Simulate corruption of the latest save on disk
    await backend.write([{ store: "worlds", value: { id: "a", version: SAVE_VERSION, edits: "garbage" } }]);

    const { save: loaded, recovered } = await persistence.loadWorld("a");
    expect(recovered).toBe(true);
    expect(decodeEdits(loaded.edits)).toEqual([[1, 1, 1, blocks.stone.id]]);
  });

  it("reports an error when no valid save exists", async () => {
    const backend = new MemoryBackend();
    const persistence = new WorldPersistence(backend);
    await expect(persistence.loadWorld("missing")).rejects.toThrow(/not found/);
    await backend.write([{ store: "worlds", value: { id: "bad", version: 99 } }]);
    await expect(persistence.loadWorld("bad")).rejects.toThrow(/newer version/);
  });

  it("deletes a world with its backup", async () => {
    const persistence = new WorldPersistence(new MemoryBackend());
    await persistence.saveWorld(save("a", []));
    await persistence.saveWorld(save("a", []));
    await persistence.deleteWorld("a");
    expect(await persistence.listWorlds()).toEqual([]);
    await expect(persistence.loadWorld("a")).rejects.toThrow();
  });
});
