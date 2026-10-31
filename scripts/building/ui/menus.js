import { placeableBlocks } from "../../blocks";
import { MAX_NAME_LENGTH } from "../saveFormat";
import { SETTINGS_SCHEMA } from "../settings";
import { createBlockIcon } from "./blockIcons";
import { CONTROLS, button, element, formatDate } from "./dom";

/**
 * Full-screen menus: loading, pause, worlds, settings, controls, inventory
 * and confirmation dialogs. Only one screen is open at a time.
 */
export class GameMenus {
  /** @type {null | "pause" | "worlds" | "settings" | "controls" | "inventory"} */
  screen = null;
  #screens = {};
  #dialog = null;
  #worldsState = { worlds: [], currentId: null, currentName: "" };

  /**
   * @param {HTMLElement} root
   * @param {{
   *   onResume: () => void, onToggleFullscreen: () => void, onSaveNow: () => void,
   *   onFreeCamera?: () => void,
   *   onPickBlock: (blockId: number) => void,
   *   onCreateWorld: (options: { name: string, seed?: number }) => void,
   *   onLoadWorld: (id: string) => void, onDeleteWorld: (id: string, name: string) => void,
   *   onResetWorld: () => void,
   *   onSettingChange: (key: string, value: any) => void,
   * }} callbacks
   * @param {{ settings: import("../settings").Settings }} options
   */
  constructor(root, callbacks, { settings }) {
    this.callbacks = callbacks;
    this.settings = settings;
    this.root = element("div", "menus", root);

    this.loading = element("div", "loading-screen", this.root);
    element("div", "spinner", this.loading).setAttribute("aria-hidden", "true");
    this.loadingText = element("p", "", this.loading, "Loading…");
    this.loading.setAttribute("role", "status");

    this.#createPause();
    this.#createWorlds();
    this.#createSettings();
    this.#createControls();
    this.#createInventory();
  }

  get isLoading() {
    return !this.loading.hidden;
  }

  get dialogOpen() {
    return this.#dialog !== null;
  }

  showLoading(message) {
    this.loadingText.textContent = message;
    this.loading.hidden = false;
  }

  hideLoading() {
    this.loading.hidden = true;
  }

  /** @param {"pause" | "worlds" | "settings" | "controls" | "inventory" | null} screen */
  open(screen) {
    this.screen = screen;
    for (const [name, el] of Object.entries(this.#screens)) el.hidden = name !== screen;
    this.root.classList.toggle("open", screen !== null);
    if (screen === "settings") this.#syncSettings();
    if (screen) this.#screens[screen].querySelector("button, input, select")?.focus({ preventScroll: true });
  }

  close() {
    this.open(null);
  }

  /**
   * Escape behaviour: closes a dialog, then goes back to the pause menu.
   * @returns {"dialog" | "pause" | "resume"} what happened
   */
  back() {
    if (this.#dialog) {
      this.#dialog.resolve(false);
      return "dialog";
    }
    if (this.screen && this.screen !== "pause" && this.screen !== "inventory") {
      this.open("pause");
      return "pause";
    }
    return "resume";
  }

  setPauseInfo({ worldName, firstStart }) {
    this.pauseTitle.textContent = worldName;
    this.pauseSubtitle.textContent = firstStart ? "Ready to build" : "Paused";
    this.resumeButton.textContent = firstStart ? "Play" : "Back to game";
  }

  setWorlds(worlds, currentId, currentName) {
    this.#worldsState = { worlds, currentId, currentName };
    this.#renderWorlds();
  }

  setInventorySelection(blockId) {
    for (const item of this.inventoryGrid.children) {
      item.classList.toggle("selected", Number(item.dataset.blockId) === blockId);
    }
  }

  /**
   * In-game confirmation dialog (no browser alerts).
   * @returns {Promise<boolean>}
   */
  confirm({ title, message, confirmLabel = "Confirm", danger = false }) {
    this.#dialog?.resolve(false);
    const overlay = element("div", "dialog-overlay", this.root);
    const dialog = element("div", "dialog panel", overlay);
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    element("h2", "", dialog, title);
    element("p", "", dialog, message);
    const actions = element("div", "dialog-actions", dialog);

    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const finish = (result) => {
        overlay.remove();
        this.#dialog = null;
        previousFocus?.focus?.({ preventScroll: true });
        resolve(result);
      };
      this.#dialog = { resolve: finish };
      const cancel = button(actions, "Cancel", () => finish(false));
      button(actions, confirmLabel, () => finish(true), danger ? "danger" : "primary");
      cancel.focus();
    });
  }

  //! Screens

  #panel(name, title) {
    const screen = element("section", "menu-screen", this.root);
    screen.hidden = true;
    screen.setAttribute("aria-label", title);
    const panel = element("div", "panel", screen);
    this.#screens[name] = screen;
    return panel;
  }

  #backButton(panel) {
    const footer = element("div", "panel-footer", panel);
    button(footer, "Back", () => this.open("pause"));
    return footer;
  }

  #createPause() {
    const panel = this.#panel("pause", "Pause menu");
    panel.classList.add("pause-panel");
    this.pauseTitle = element("h1", "", panel, "");
    this.pauseSubtitle = element("p", "panel-hint", panel, "");
    const actions = element("div", "menu-actions", panel);
    this.resumeButton = button(actions, "Play", () => this.callbacks.onResume(), "primary");
    button(actions, "Worlds", () => this.#openWorlds());
    button(actions, "Settings", () => this.open("settings"));
    button(actions, "Controls", () => this.open("controls"));
    button(actions, "Fullscreen", () => this.callbacks.onToggleFullscreen());
    button(actions, "Save now", () => this.callbacks.onSaveNow());
    if (this.callbacks.onFreeCamera) {
      button(actions, "Free camera (debug)", () => this.callbacks.onFreeCamera());
    }
  }

  #openWorlds() {
    this.open("worlds");
    this.callbacks.onOpenWorlds?.();
  }

  #createWorlds() {
    const panel = this.#panel("worlds", "Worlds");
    element("h2", "", panel, "Worlds");

    const current = element("div", "current-world", panel);
    this.currentWorldLabel = element("span", "", current);
    button(current, "Reset world", () => this.callbacks.onResetWorld(), "danger");

    const form = element("form", "new-world", panel);
    element("div", "panel-title", form, "New world");
    const name = element("input", "", form);
    Object.assign(name, { name: "name", placeholder: "World name", maxLength: MAX_NAME_LENGTH, required: true });
    name.setAttribute("aria-label", "World name");
    const seed = element("input", "", form);
    Object.assign(seed, { name: "seed", type: "number", placeholder: "Seed (random)", step: "any" });
    seed.setAttribute("aria-label", "Seed (optional)");
    const generator = element("select", "", form);
    generator.name = "generator";
    generator.setAttribute("aria-label", "World type");
    for (const [value, text] of [["natural", "Natural (biomes, rivers)"], ["classic", "Classic hills"]]) {
      element("option", "", generator, text).value = value;
    }
    const chunkWidth = element("select", "", form);
    chunkWidth.name = "chunkWidth";
    chunkWidth.setAttribute("aria-label", "Chunk size");
    for (const [value, text] of [["", "Default chunks"], ["16", "16-block chunks"], ["32", "32-block chunks"], ["64", "64-block chunks"]]) {
      element("option", "", chunkWidth, text).value = value;
    }
    const create = element("button", "primary", form, "Create");
    create.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const seedValue = seed.value.trim() === "" ? undefined : Number(seed.value);
      this.callbacks.onCreateWorld({
        name: name.value,
        seed: seedValue,
        generator: generator.value,
        chunkWidth: chunkWidth.value ? Number(chunkWidth.value) : undefined,
      });
      form.reset();
    });

    element("div", "panel-title", panel, "Saved worlds");
    this.worldList = element("ul", "world-list", panel);
    this.#backButton(panel);
  }

  #renderWorlds() {
    const { worlds, currentId, currentName } = this.#worldsState;
    this.currentWorldLabel.textContent = `Playing: ${currentName}`;
    this.worldList.replaceChildren();
    if (worlds.length === 0) element("li", "panel-hint", this.worldList, "No saved worlds yet.");
    for (const world of worlds) {
      const row = element("li", "world-row", this.worldList);
      const info = element("div", "", row);
      element("div", "world-name", info, world.name);
      element(
        "div",
        "panel-hint",
        info,
        `${formatDate(world.updatedAt)} · ${world.generator === "natural" ? "Natural" : "Classic"} · ${world.editCount.toLocaleString()} changes · seed ${world.seed}`
      );
      const isCurrent = world.id === currentId;
      const load = button(row, isCurrent ? "Playing" : "Load", () => this.callbacks.onLoadWorld(world.id));
      load.disabled = isCurrent;
      button(row, "Delete", () => this.callbacks.onDeleteWorld(world.id, world.name), "danger");
    }
  }

  #createSettings() {
    const panel = this.#panel("settings", "Settings");
    element("h2", "", panel, "Settings");
    const form = element("div", "settings-form", panel);
    this.settingInputs = new Map();

    for (const field of SETTINGS_SCHEMA) {
      const id = `setting-${field.key}`;
      const row = element("div", "setting-row", form);
      const label = element("label", "", row, field.label);
      label.htmlFor = id;
      let input;
      if (field.type === "range") {
        input = element("input", "", row);
        Object.assign(input, { type: "range", min: field.min, max: field.max, step: field.step });
        const output = element("output", "", row);
        input.output = output;
        input.format = (v) => (field.percent ? `${Math.round(v * 100)}%` : `${v}${field.unit ?? ""}`);
        input.addEventListener("input", () => {
          output.textContent = input.format(Number(input.value));
          this.callbacks.onSettingChange(field.key, Number(input.value));
        });
      } else if (field.type === "toggle") {
        input = element("input", "", row);
        input.type = "checkbox";
        input.addEventListener("change", () => this.callbacks.onSettingChange(field.key, input.checked));
      } else {
        input = element("select", "", row);
        for (const [value, text] of field.options) {
          const option = element("option", "", input, text);
          option.value = String(value);
        }
        // Option values keep their type (numbers or strings)
        input.addEventListener("change", () => {
          const [value] = field.options.find(([option]) => String(option) === input.value);
          this.callbacks.onSettingChange(field.key, value);
        });
      }
      input.id = id;
      this.settingInputs.set(field.key, input);
    }
    this.#backButton(panel);
  }

  #syncSettings() {
    for (const [key, input] of this.settingInputs) {
      const value = this.settings.get(key);
      if (input.type === "checkbox") input.checked = value;
      else input.value = String(value);
      if (input.output) input.output.textContent = input.format(value);
    }
  }

  #createControls() {
    const panel = this.#panel("controls", "Controls");
    element("h2", "", panel, "Controls");
    const list = element("dl", "controls-list", panel);
    for (const [key, action] of CONTROLS) {
      element("dt", "", list, key);
      element("dd", "", list, action);
    }
    this.#backButton(panel);
  }

  #createInventory() {
    const panel = this.#panel("inventory", "Inventory");
    element("h2", "", panel, "Blocks");
    element("p", "panel-hint", panel, "Choose a hotbar slot below, then click a block to put it there.");
    this.inventoryGrid = element("div", "inventory-grid", panel);
    for (const blockType of placeableBlocks) {
      const item = button(this.inventoryGrid, "", () => this.callbacks.onPickBlock(blockType.id), "inventory-item");
      item.dataset.blockId = blockType.id;
      item.append(createBlockIcon(blockType));
      element("span", "", item, blockType.label);
    }
    const footer = element("div", "panel-footer", panel);
    element("span", "panel-hint", footer, "E or Esc to close");
    button(footer, "Done", () => this.callbacks.onResume(), "primary");
  }
}
