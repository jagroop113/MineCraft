const MOUSE = { left: 0, middle: 1, right: 2 };

function isTextInput(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
}

/**
 * Turns keyboard / mouse / focus events into game actions. All listeners are
 * registered with one AbortSignal, so dispose() removes every one of them.
 *
 * Keys go through a capture listener on window, which runs before Player's
 * document listener: while a menu is open the event is stopped there, so the
 * player can't move or re-lock the pointer behind the menu.
 */
export class InputController {
  // Holding a mouse button repeats the action, which makes walls quick to build
  repeatDelay = 0.22;
  firstRepeatDelay = 0.3;

  #abort = new AbortController();
  #heldButton = null;
  #repeatTimer = 0;

  /**
   * @param {{
   *   player: import("../player").Player,
   *   canvas: HTMLCanvasElement,
   *   getState: () => "loading" | "playing" | "menu" | "inventory" | "freecam",
   *   isTouchMode?: () => boolean,
   *   actions: Record<string, (...args: any[]) => void>,
   * }} options
   */
  constructor({ player, canvas, getState, isTouchMode = () => false, actions }) {
    this.player = player;
    this.getState = getState;
    this.isTouchMode = isTouchMode;
    this.actions = actions;
    const signal = this.#abort.signal;

    window.addEventListener("keydown", (event) => this.#onKeyDown(event), { capture: true, signal });
    window.addEventListener(
      "keyup",
      (event) => {
        if (event.code === "ShiftLeft" || event.code === "ShiftRight") this.player.sprinting = false;
      },
      { signal }
    );
    document.addEventListener("mousedown", (event) => this.#onMouseDown(event), { signal });
    document.addEventListener("mouseup", (event) => this.#onMouseUp(event), { signal });
    document.addEventListener("wheel", (event) => this.#onWheel(event), { passive: true, signal });
    document.addEventListener(
      "contextmenu",
      (event) => {
        // No browser menu on right-click inside the game (UI text fields keep theirs)
        if (event.target === canvas || this.getState() === "playing") event.preventDefault();
      },
      { signal }
    );
    window.addEventListener("blur", () => this.#onFocusLost(), { signal });
    document.addEventListener(
      "visibilitychange",
      () => document.visibilityState === "hidden" && this.#onFocusLost(true),
      { signal }
    );
  }

  /** Repeats the held mouse action */
  update(dt) {
    if (this.#heldButton === null) return;
    if (this.getState() !== "playing") {
      this.#heldButton = null;
      return;
    }
    this.#repeatTimer -= dt;
    if (this.#repeatTimer <= 0) {
      this.#repeatTimer = this.repeatDelay;
      this.#useButton(this.#heldButton, true);
    }
  }

  releaseButtons() {
    this.#heldButton = null;
  }

  dispose() {
    this.#abort.abort();
  }

  #onKeyDown(event) {
    const state = this.getState();
    const typing = isTextInput(event.target);

    if (state === "freecam") {
      // Other keys reach Player, which locks the pointer and resumes play (original behaviour)
      if (event.code === "Escape") {
        event.stopPropagation();
        this.actions.back();
      }
      return;
    }

    if (state !== "playing") {
      event.stopPropagation();
      if (state === "loading" || (typing && event.code !== "Escape")) return;
      if (event.code === "Escape") this.actions.back();
      else if (event.code === "KeyE" && state === "inventory") this.actions.toggleInventory();
      else if (event.code === "KeyF" && !event.repeat) this.actions.toggleFullscreen();
      else if (state === "inventory" && /^Digit[1-9]$/.test(event.code)) {
        this.actions.selectSlot(Number(event.code.slice(5)) - 1);
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const action = {
        KeyZ: event.shiftKey ? this.actions.redo : this.actions.undo,
        KeyY: this.actions.redo,
        KeyS: event.repeat ? null : this.actions.save,
      }[event.code];
      if (action !== undefined) {
        event.preventDefault();
        action?.();
      }
      return;
    }

    if (/^Digit[1-9]$/.test(event.code)) {
      this.actions.selectSlot(Number(event.code.slice(5)) - 1);
      return;
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      this.player.sprinting = true;
      return;
    }
    if (event.repeat) return;

    switch (event.code) {
      case "KeyE":
        event.stopPropagation();
        this.actions.toggleInventory();
        break;
      case "KeyB":
        this.actions.toggleMode();
        break;
      case "KeyH":
        this.actions.toggleHelp();
        break;
      case "KeyF":
        this.actions.toggleFullscreen();
        break;
      case "KeyR":
        // Player's own reset uses a fixed height that can be inside terrain in other worlds
        event.stopPropagation();
        this.actions.respawn();
        break;
    }
  }

  #onMouseDown(event) {
    // Taps on touch screens also produce mouse events; the touch controls handle those
    if (this.getState() !== "playing" || this.isTouchMode()) return;
    this.#heldButton = event.button;
    this.#repeatTimer = this.firstRepeatDelay;
    this.#useButton(event.button, false);
  }

  #onMouseUp(event) {
    if (event.button === this.#heldButton) this.#heldButton = null;
  }

  #onWheel(event) {
    if (this.getState() !== "playing" || event.deltaY === 0) return;
    this.actions.scrollSlot(Math.sign(event.deltaY));
  }

  #useButton(button, repeat) {
    if (button === MOUSE.left) this.actions.place(repeat);
    else if (button === MOUSE.right) this.actions.remove(repeat);
    else if (button === MOUSE.middle && !repeat) this.actions.pick();
  }

  // Keys released while unfocused never send keyup, so stop all movement
  #onFocusLost(hidden = false) {
    this.player.clearInput();
    this.#heldButton = null;
    this.actions.focusLost(hidden);
  }
}
