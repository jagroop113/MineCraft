import { describe, expect, it, vi } from "vitest";
import { blocks, defaultHotbar } from "../scripts/blocks";
import { Inventory } from "../scripts/building/inventory";
import { Settings } from "../scripts/building/settings";
import { MemoryStorage } from "./helpers";

describe("Inventory", () => {
  it("starts with the default hotbar and the first slot selected", () => {
    const inventory = new Inventory();
    expect(inventory.slots).toEqual(defaultHotbar);
    expect(inventory.selectedSlot).toBe(0);
    expect(inventory.selectedBlockId).toBe(defaultHotbar[0]);
  });

  it("selects slots and wraps around when scrolling", () => {
    const inventory = new Inventory();
    inventory.select(4);
    expect(inventory.selectedSlot).toBe(4);
    inventory.select(0);
    inventory.selectNext(-1);
    expect(inventory.selectedSlot).toBe(8);
    inventory.selectNext(1);
    expect(inventory.selectedSlot).toBe(0);
  });

  it("assigns placeable blocks and rejects invalid ones", () => {
    const inventory = new Inventory();
    expect(inventory.assign(blocks.water.id, 2)).toBe(true);
    expect(inventory.slots[2]).toBe(blocks.water.id);
    expect(inventory.assign(blocks.empty.id)).toBe(false);
    expect(inventory.assign(999)).toBe(false);
    expect(inventory.assign(blocks.stone.id, 9)).toBe(false);
  });

  it("notifies listeners on change", () => {
    const inventory = new Inventory();
    const listener = vi.fn();
    inventory.onChange(listener);
    inventory.select(3);
    inventory.assign(blocks.glass.id);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(inventory.selectedBlockId).toBe(blocks.glass.id);
  });

  it("repairs invalid saved hotbars", () => {
    const inventory = new Inventory([blocks.brick.id, "x", 999, null]);
    expect(inventory.slots[0]).toBe(blocks.brick.id);
    expect(inventory.slots.slice(1, 4)).toEqual(defaultHotbar.slice(1, 4));
    expect(inventory.slots).toHaveLength(9);
  });
});

describe("Settings", () => {
  it("validates and clamps values, and persists them", () => {
    const storage = new MemoryStorage();
    const settings = new Settings(storage);
    expect(settings.set("reach", 100)).toBe(true);
    expect(settings.get("reach")).toBe(12);
    expect(settings.set("shadows", "yes")).toBe(false);
    expect(settings.set("autosaveSeconds", 7)).toBe(false);
    expect(settings.set("unknown", 1)).toBe(false);
    settings.hotbar = [blocks.sand.id];
    settings.save();

    const reloaded = new Settings(storage);
    expect(reloaded.get("reach")).toBe(12);
    expect(reloaded.hotbar).toEqual([blocks.sand.id]);
  });

  it("ignores corrupted stored settings", () => {
    const storage = new MemoryStorage();
    storage.setItem("minecraft-js:settings", "{not json");
    expect(new Settings(storage).get("reach")).toBe(6);
    storage.setItem("minecraft-js:settings", JSON.stringify({ values: { reach: "far", fov: 90 } }));
    const settings = new Settings(storage);
    expect(settings.get("reach")).toBe(6);
    expect(settings.get("fov")).toBe(90);
  });
});
