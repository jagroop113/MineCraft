import { describe, expect, it } from "vitest";
import { BlockHistory } from "../scripts/building/history";

const change = (n) => ({ x: n, y: 0, z: 0, from: 0, to: 1 });

describe("BlockHistory", () => {
  it("undoes and redoes in order", () => {
    const history = new BlockHistory();
    history.record(change(1));
    history.record(change(2));
    expect(history.undo()).toEqual(change(2));
    expect(history.undo()).toEqual(change(1));
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toEqual(change(1));
    expect(history.redo()).toEqual(change(2));
    expect(history.redo()).toBeUndefined();
  });

  it("clears redo history when a new action is recorded after undo", () => {
    const history = new BlockHistory();
    history.record(change(1));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.record(change(2));
    expect(history.canRedo).toBe(false);
  });

  it("keeps only the newest entries up to the limit", () => {
    const history = new BlockHistory(3);
    for (let i = 1; i <= 5; i++) history.record(change(i));
    expect([history.undo(), history.undo(), history.undo(), history.undo()].map((c) => c?.x)).toEqual([5, 4, 3, undefined]);
  });

  it("trims existing entries when the limit is lowered", () => {
    const history = new BlockHistory(10);
    for (let i = 1; i <= 5; i++) history.record(change(i));
    history.limit = 2;
    expect(history.undo().x).toBe(5);
    expect(history.undo().x).toBe(4);
    expect(history.canUndo).toBe(false);
  });
});
