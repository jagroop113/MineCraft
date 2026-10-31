import { getBlockType } from "../../blocks";
import { HOTBAR_SIZE } from "../inventory";
import { ICON_SIZE, updateBlockIcon } from "./blockIcons";
import { CONTROLS, element } from "./dom";

const TOAST_LIMIT = 3;

/**
 * In-game overlay: crosshair, hotbar, selected block, mode, controls panel,
 * notifications, save indicator and performance stats. Renders state only.
 */
export class BuildHUD {
  #slots = [];
  #nameTimer = null;
  #saveTimer = null;

  /** @param {{ onSelectSlot: (slot: number) => void }} callbacks */
  constructor(root, callbacks) {
    this.root = element("div", "hud", root);

    element("div", "crosshair", this.root).setAttribute("aria-hidden", "true");
    this.modeBadge = element("div", "mode-badge", this.root);
    this.blockName = element("div", "block-name", this.root);
    this.blockName.setAttribute("aria-live", "polite");

    this.hotbar = element("div", "hotbar", root);
    this.hotbar.setAttribute("role", "toolbar");
    this.hotbar.setAttribute("aria-label", "Hotbar");
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = element("button", "hotbar-slot", this.hotbar);
      slot.type = "button";
      slot.icon = element("canvas", "block-icon", slot);
      slot.icon.width = slot.icon.height = ICON_SIZE;
      element("span", "slot-key", slot, String(i + 1));
      slot.addEventListener("click", () => callbacks.onSelectSlot(i));
      this.#slots.push(slot);
    }

    this.help = element("aside", "help-panel", this.root);
    element("div", "panel-title", this.help, "Controls");
    const list = element("dl", "", this.help);
    for (const [key, action] of CONTROLS) {
      element("dt", "", list, key);
      element("dd", "", list, action);
    }

    this.worldInfo = element("div", "world-info", root);
    this.saveIndicator = element("div", "save-indicator", root);
    this.saveIndicator.setAttribute("aria-live", "polite");
    this.perf = element("pre", "perf-stats", root);
    this.perf.hidden = true;
    this.toasts = element("div", "toasts", root);
    this.toasts.setAttribute("aria-live", "assertive");
  }

  setHotbar(slots, selectedSlot, { announce = true } = {}) {
    slots.forEach((blockId, i) => {
      const slot = this.#slots[i];
      const blockType = getBlockType(blockId);
      slot.title = `${i + 1}: ${blockType.label}`;
      slot.setAttribute("aria-label", slot.title);
      slot.setAttribute("aria-pressed", String(i === selectedSlot));
      updateBlockIcon(slot.icon, blockType);
      slot.classList.toggle("selected", i === selectedSlot);
    });
    if (announce) this.#showBlockName(getBlockType(slots[selectedSlot]).label);
  }

  setMode(mode) {
    this.modeBadge.textContent = mode === "build" ? "Build mode" : "Explore mode";
    this.root.classList.toggle("explore", mode !== "build");
  }

  /** Crosshair and in-game hints only show while the player is in control */
  setPlaying(playing) {
    this.root.classList.toggle("playing", playing);
  }

  /** World name, biome, time, weather and coordinates */
  setWorldInfo(text) {
    if (this.worldInfo.textContent !== text) this.worldInfo.textContent = text;
  }

  setHelpVisible(visible) {
    this.help.hidden = !visible;
  }

  /** @param {"info" | "error"} type */
  toast(message, type = "info") {
    if (!message) return;
    // Repeating the newest message just restarts its timer
    const last = this.toasts.lastElementChild;
    if (last?.textContent === message) {
      last.remove();
    }
    const toast = element("div", `toast ${type}`, this.toasts, message);
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    while (this.toasts.children.length > TOAST_LIMIT) this.toasts.firstElementChild.remove();
    setTimeout(() => toast.remove(), type === "error" ? 5000 : 2200);
  }

  /** @param {{ state: "loading" | "saving" | "saved" | "error" }} status */
  setSaveStatus({ state }) {
    const labels = { saving: "Saving…", saved: "Saved", error: "Save failed", loading: "Loading…" };
    this.saveIndicator.textContent = labels[state] ?? "";
    this.saveIndicator.className = `save-indicator visible ${state}`;
    clearTimeout(this.#saveTimer);
    if (state === "saved") {
      this.#saveTimer = setTimeout(() => this.saveIndicator.classList.remove("visible"), 1800);
    }
  }

  #showBlockName(name) {
    this.blockName.textContent = name;
    this.blockName.classList.add("visible");
    clearTimeout(this.#nameTimer);
    this.#nameTimer = setTimeout(() => this.blockName.classList.remove("visible"), 1500);
  }
}
