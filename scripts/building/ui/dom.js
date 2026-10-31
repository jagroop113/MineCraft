/** Creates an element with an optional class, parent and text */
export function element(tag, className, parent, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  parent?.append(el);
  return el;
}

/** Creates a <button type="button"> wired to onClick */
export function button(parent, label, onClick, className = "") {
  const el = element("button", className, parent, label);
  el.type = "button";
  el.addEventListener("click", onClick);
  return el;
}

export function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const CONTROLS = [
  ["W A S D", "Move"],
  ["Space", "Jump"],
  ["Shift", "Sprint (hold)"],
  ["R", "Back to spawn"],
  ["Mouse", "Look around"],
  ["Left click", "Place block (hold to repeat)"],
  ["Right click", "Remove block (hold to repeat)"],
  ["Middle click", "Pick targeted block"],
  ["1 – 9 / Wheel", "Select hotbar slot"],
  ["E", "Inventory"],
  ["B", "Build / explore mode"],
  ["Ctrl + Z", "Undo"],
  ["Ctrl + Y", "Redo"],
  ["Ctrl + S", "Save now"],
  ["F", "Fullscreen"],
  ["H", "Show / hide controls"],
  ["Esc", "Pause / back"],
];
