import { describe, expect, it } from "vitest";
import { blocks } from "../scripts/blocks";
import {
  SAVE_VERSION,
  SaveDataError,
  decodeEdits,
  encodeEdits,
  parseSave,
} from "../scripts/building/saveFormat";

function validSave(overrides = {}) {
  return {
    version: SAVE_VERSION,
    id: "world-1",
    name: "Test",
    createdAt: 1,
    updatedAt: 2,
    params: { seed: 7, terrain: { scale: 30, magnitude: 0.5, offset: 0.2 } },
    chunkSize: { width: 64, height: 32 },
    player: { position: [1, 20, 3], yaw: 0.5, pitch: -0.2 },
    edits: encodeEdits([
      [1, 2, 3, blocks.brick.id],
      [-64, 0, 127, blocks.empty.id],
    ]),
    ...overrides,
  };
}

describe("save format", () => {
  it("round-trips edits through the packed encoding", () => {
    const edits = [
      [1, 2, 3, 4],
      [-5, 6, -7, 0],
    ];
    expect(decodeEdits(encodeEdits(edits))).toEqual(edits);
  });

  it("accepts a valid save unchanged", () => {
    const { save, warnings } = parseSave(validSave());
    expect(warnings).toEqual([]);
    expect(save.player).toEqual({ position: [1, 20, 3], yaw: 0.5, pitch: -0.2 });
    expect(decodeEdits(save.edits)).toHaveLength(2);
  });

  it("migrates version 1 saves", () => {
    const v1 = {
      version: 1,
      savedAt: 1000,
      params: { seed: 3, terrain: { scale: 30, magnitude: 0.5, offset: 0.2 } },
      chunkSize: { width: 64, height: 32 },
      player: [4, 18, 4],
      edits: [[10, 5, 10, blocks.stone.id]],
    };
    const { save } = parseSave({ ...v1, id: "legacy", name: "Old" });
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.createdAt).toBe(1000);
    expect(save.player.position).toEqual([4, 18, 4]);
    expect(decodeEdits(save.edits)).toEqual([[10, 5, 10, blocks.stone.id]]);
    expect(save.params.generator).toBe("classic");
  });

  it("migrates version 2 saves to the classic generator", () => {
    const { save } = parseSave(validSave({ version: 2, params: { seed: 4, terrain: { scale: 30, magnitude: 0.5, offset: 0.2 } } }));
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.params).toEqual({ seed: 4, generator: "classic", biomeScale: 1, terrain: { scale: 30, magnitude: 0.5, offset: 0.2 } });
    expect(save.environment).toBeNull();
  });

  it("keeps the generator, biome scale and environment of version 3 saves", () => {
    const { save } = parseSave(
      validSave({ params: { seed: 9, generator: "natural", biomeScale: 2, terrain: { scale: 80, magnitude: 0.5, offset: 0.3 } }, environment: { time: 0.75, weather: "rain" } })
    );
    expect(save.params.generator).toBe("natural");
    expect(save.params.biomeScale).toBe(2);
    expect(save.environment).toEqual({ time: 0.75, weather: "rain" });
  });

  it("rejects unknown world types and drops invalid environment data", () => {
    expect(() => parseSave(validSave({ params: { seed: 1, generator: "mars", terrain: { scale: 30, magnitude: 0.5, offset: 0.2 } } }))).toThrow(SaveDataError);
    expect(parseSave(validSave({ environment: { time: 7, weather: "rain" } })).save.environment).toBeNull();
  });

  it("rejects saves from a newer version", () => {
    expect(() => parseSave(validSave({ version: SAVE_VERSION + 1 }))).toThrow(/newer version/);
  });

  it.each([
    ["null", null],
    ["a string", "hello"],
    ["no version", { id: "x" }],
    ["missing id", validSave({ id: "" })],
    ["bad terrain", validSave({ params: { seed: "x", terrain: {} } })],
    ["bad world size", validSave({ chunkSize: { width: 1000, height: 32 } })],
    ["truncated block data", validSave({ edits: [1, 2, 3] })],
    ["non-numeric block data", validSave({ edits: [1, 2, "a", 4] })],
  ])("rejects corrupted data: %s", (_, data) => {
    expect(() => parseSave(data)).toThrow(SaveDataError);
  });

  it("drops individual invalid edits but keeps the rest", () => {
    const edits = encodeEdits([
      [1, 2, 3, blocks.brick.id],
      [1, 99, 3, blocks.brick.id], // above the world
      [2 ** 30 + 5, 2, 3, blocks.brick.id], // absurdly far away
      [1, 2, 4, 9999], // unknown block
    ]);
    const { save, warnings } = parseSave(validSave({ edits }));
    expect(decodeEdits(save.edits)).toEqual([[1, 2, 3, blocks.brick.id]]);
    expect(warnings[0]).toMatch(/3 invalid/);
  });

  it("falls back to a spawn position when the player data is invalid", () => {
    const { save } = parseSave(validSave({ player: { position: [1, NaN, 2] } }));
    expect(save.player).toBeNull();
  });
});
