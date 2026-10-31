import { blocks, getBlockType } from "../blocks";
import { BlockTargeting } from "./blockTargeting";
import { BlockHistory } from "./history";

/**
 * Block placement / destruction rules and undo history. Pure game logic:
 * it reports outcomes ({ ok, error }) and leaves presentation to the UI.
 */
export class BuildingSystem {
  /** "build" | "explore" */
  mode = "build";
  #listeners = new Set();

  /**
   * @param {{
   *   scene: THREE.Scene, world: import("../world").World, player: import("../player").Player,
   *   inventory: import("./inventory").Inventory,
   *   effects?: { onPlace?: (position, blockType) => void, onBreak?: (position, blockType) => void },
   * }} options
   */
  constructor({ scene, world, player, inventory, effects = {} }) {
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.effects = effects;
    this.targeting = new BlockTargeting(scene, world, player);
    this.history = new BlockHistory();
  }

  /** @param {boolean} active whether the player is in control (pointer locked, not paused) */
  update(active) {
    const targeting = active && this.mode === "build";
    this.targeting.update(targeting ? this.inventory.selectedBlockId : null);
  }

  placeBlock() {
    const { target, placement } = this.targeting;
    if (!target) return { ok: false, error: null };
    if (!placement) {
      const cell = this.targeting.getAdjacentCell(target);
      return { ok: false, error: this.targeting.getPlaceError(cell, this.inventory.selectedBlockId) };
    }
    return this.setBlock(placement.x, placement.y, placement.z, this.inventory.selectedBlockId);
  }

  removeBlock() {
    const target = this.targeting.target;
    if (!target) return { ok: false, error: null };
    const error = this.targeting.getRemoveError(target.position);
    if (error) return { ok: false, error };
    const { x, y, z } = target.position;
    return this.setBlock(x, y, z, blocks.empty.id);
  }

  /** Puts the targeted block's type into the selected hotbar slot */
  pickBlock() {
    const target = this.targeting.target;
    if (!target) return { ok: false, error: null };
    if (!this.inventory.assign(target.block.id)) return { ok: false, error: "That block can't be picked" };
    return { ok: true };
  }

  undo() {
    const change = this.history.undo();
    if (!change) return { ok: false, error: "Nothing to undo" };
    return this.setBlock(change.x, change.y, change.z, change.from, { record: false });
  }

  redo() {
    const change = this.history.redo();
    if (!change) return { ok: false, error: "Nothing to redo" };
    return this.setBlock(change.x, change.y, change.z, change.to, { record: false });
  }

  /**
   * Applies one block change to the world, records it and plays effects.
   * Every edit (placing, breaking, undo, redo) goes through here so the
   * history and the world never drift apart.
   */
  setBlock(x, y, z, id, { record = true } = {}) {
    const from = this.world.getBlock(x, y, z)?.id;
    if (from === undefined) return { ok: false, error: "Outside the world" };
    if (from === id) return { ok: false, error: null };
    if (!this.world.setBlock(x, y, z, id)) return { ok: false, error: "Outside the world" };

    if (record) this.history.record({ x, y, z, from, to: id });

    const position = { x, y, z };
    if (id === blocks.empty.id) this.effects.onBreak?.(position, getBlockType(from));
    else this.effects.onPlace?.(position, getBlockType(id));

    this.#listeners.forEach((listener) => listener({ x, y, z, from, to: id }));
    return { ok: true };
  }

  toggleMode() {
    this.mode = this.mode === "build" ? "explore" : "build";
    return this.mode;
  }

  /** @param {(change: {x,y,z,from,to}) => void} listener @returns unsubscribe */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.targeting.dispose();
    this.#listeners.clear();
  }
}
