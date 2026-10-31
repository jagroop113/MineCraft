import { defaultHotbar, isPlaceable } from "../blocks";

export const HOTBAR_SIZE = 9;

/**
 * The 9-slot hotbar. Creative mode: every block is unlimited, so slots hold
 * a block id and no quantity.
 */
export class Inventory {
  selectedSlot = 0;
  #listeners = new Set();

  /** @param {number[]} [slots] block ids; invalid entries fall back to the defaults */
  constructor(slots = defaultHotbar) {
    this.slots = Array.from({ length: HOTBAR_SIZE }, (_, i) =>
      isPlaceable(slots?.[i]) ? slots[i] : defaultHotbar[i]
    );
  }

  get selectedBlockId() {
    return this.slots[this.selectedSlot];
  }

  /** Selects a slot; out-of-range values wrap around (for the mouse wheel) */
  select(slot) {
    if (!Number.isInteger(slot)) return;
    this.selectedSlot = ((slot % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.#emit();
  }

  selectNext(delta) {
    this.select(this.selectedSlot + Math.sign(delta));
  }

  /** Puts a block type into a slot (the selected one by default) */
  assign(blockId, slot = this.selectedSlot) {
    if (!isPlaceable(blockId) || slot < 0 || slot >= HOTBAR_SIZE) return false;
    this.slots[slot] = blockId;
    this.#emit();
    return true;
  }

  /** @param {(inventory: Inventory) => void} listener @returns unsubscribe */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    this.#listeners.forEach((listener) => listener(this));
  }
}
