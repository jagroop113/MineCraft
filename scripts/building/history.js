/**
 * Undo/redo stack of logical block changes (never scene snapshots).
 * Each entry is { x, y, z, from, to } where from/to are block ids.
 */
export class BlockHistory {
  #limit;
  #undoStack = [];
  #redoStack = [];

  constructor(limit = 500) {
    this.limit = limit;
  }

  get limit() {
    return this.#limit;
  }

  set limit(value) {
    this.#limit = Math.max(1, Math.floor(value));
    if (this.#undoStack.length > this.#limit) {
      this.#undoStack.splice(0, this.#undoStack.length - this.#limit);
    }
  }

  get canUndo() {
    return this.#undoStack.length > 0;
  }

  get canRedo() {
    return this.#redoStack.length > 0;
  }

  /** Adds a new change; any redo history is discarded */
  record(change) {
    this.#undoStack.push(change);
    if (this.#undoStack.length > this.#limit) this.#undoStack.shift();
    this.#redoStack.length = 0;
  }

  /** @returns the change to revert, or undefined */
  undo() {
    const change = this.#undoStack.pop();
    if (change) this.#redoStack.push(change);
    return change;
  }

  /** @returns the change to re-apply, or undefined */
  redo() {
    const change = this.#redoStack.pop();
    if (change) this.#undoStack.push(change);
    return change;
  }

  clear() {
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }
}
